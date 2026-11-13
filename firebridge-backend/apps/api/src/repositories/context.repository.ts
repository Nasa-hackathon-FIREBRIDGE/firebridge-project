import type { SnapshotDatabase, SqlReader } from './database.js';
import {
  NativeResultsReader,
  type NativeAnalysis,
  type Component
} from './native-results.repository.js';
import { ApiError } from '../utils/response.js';

export interface AnalysisContext {
  a: NativeAnalysis;
  components: Component[];
  config: Record<string, unknown>;
}
export class ContextRepository {
  constructor(readonly database: SnapshotDatabase) {}
  read<T>(fn: (db: SqlReader) => Promise<T>) {
    return this.database.snapshot(async (db) => {
      await db.query("SET LOCAL TIME ZONE 'UTC'");
      return fn(db);
    });
  }
  async context(db: SqlReader, id: string): Promise<AnalysisContext> {
    const reader = new NativeResultsReader(db);
    const a = await reader.analysis(id);
    if (!a) throw new ApiError(404, 'ANALYSIS_NOT_FOUND', 'Analysis not found.');
    if (a.release_status !== 'published' || !a.published_at)
      throw new ApiError(409, 'RELEASE_NOT_READY', 'Pinned release is not published.');
    const components = await reader.components(id);
    if (components.find((c) => c.component === 'satellite')?.release_id !== a.release_id)
      throw new ApiError(
        409,
        'INCONSISTENT_SNAPSHOT',
        'Satellite component does not match the pinned release.'
      );
    const releases = await db.query<{ config: Record<string, unknown> }>(
      'SELECT config FROM firebridge.data_releases WHERE id=$1::uuid',
      [a.release_id]
    );
    return { a, components, config: releases[0].config };
  }
  async component(db: SqlReader, c: AnalysisContext, name: string, kind: string) {
    const selected = c.components.find((v) => v.component === name);
    if (!selected?.release_id || !['ready', 'partial'].includes(selected.status)) return null;
    const rows = await db.query<{ id: string }>(
      `SELECT id::text FROM firebridge.data_releases
      WHERE id=$1::uuid AND status='published' AND published_at IS NOT NULL AND dataset_kind=$2 AND scope_key=$3`,
      [selected.release_id, kind, c.a.scope_key]
    );
    if (!rows.length)
      throw new ApiError(
        409,
        'CONTEXT_RELEASE_NOT_READY',
        'Pinned context release is not servable.'
      );
    return rows[0].id;
  }
  /** Exact SQL-serving membership, supplied and checked by publication workers. */
  async members(
    db: SqlReader,
    release: string,
    kind: 'weather' | 'reports',
    field: 'weather_value_ids' | 'weather_summary_ids' | 'reported_event_ids'
  ) {
    const rows = await db.query<{
      support_spec: Record<string, unknown>;
      row_count: string;
      validation_status: string;
      serving_complete: boolean;
    }>(
      `SELECT p.support_spec,p.row_count::text,p.validation_status,p.serving_complete
      FROM firebridge.release_partitions rp JOIN firebridge.data_partitions p ON p.id=rp.partition_id
      WHERE rp.release_id=$1::uuid AND p.kind=$2 AND p.support_spec ? $3
      ORDER BY rp.series_key,rp.partition_key LIMIT 1001`,
      [release, kind, field]
    );
    if (rows.length > 1000)
      throw new ApiError(422, 'SCOPE_TOO_LARGE', 'Context partition limit exceeded.');
    const ids = new Set<string>();
    if (!rows.length) return { ids: [], ready: false };
    for (const p of rows) {
      const members = p.support_spec[field];
      if (
        p.validation_status !== 'validated' ||
        !p.serving_complete ||
        !Array.isArray(members) ||
        !members.every(
          (v) =>
            typeof v === 'string' &&
            (field === 'weather_value_ids'
              ? /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n
              : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
        ) ||
        String(new Set(members).size) !== p.row_count
      )
        return { ids: [], ready: false };
      for (const id of members as string[]) ids.add(id);
      if (ids.size > 10000)
        throw new ApiError(422, 'SCOPE_TOO_LARGE', 'Context membership limit exceeded.');
    }
    return { ids: [...ids].sort(), ready: true };
  }
}
