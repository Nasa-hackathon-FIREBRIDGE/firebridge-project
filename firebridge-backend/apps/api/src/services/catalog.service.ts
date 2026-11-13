import {
  CatalogRepository,
  type JsonRow,
  type Release
} from '../repositories/catalog.repository.js';
import { ApiError } from '../utils/response.js';
import { CursorCodec } from '../utils/cursor.js';

type Settings = {
  DEFAULT_SCOPE_KEY: string;
  CURSOR_SECRET: string;
  MAX_AOI_VERTICES: number;
  MAX_AOI_AREA_KM2: number;
  MAX_EVIDENCE_CELL_DAYS: number;
  MAX_POINTS_PER_PAGE: number;
};
export type ReleaseQuery = {
  membership?: 'partitions' | 'assets';
  limit?: string;
  cursor?: string;
};
export type UpdatesQuery = {
  scope_key: string;
  after_release_id?: string;
  component?: string;
  alias?: string;
};

export class CatalogService {
  private cursors: CursorCodec;
  constructor(
    private repository: CatalogRepository,
    private settings: Settings
  ) {
    this.cursors = new CursorCodec(settings.CURSOR_SECRET);
  }
  private noSnapshot(): never {
    throw new ApiError(
      503,
      'NO_PUBLISHED_SNAPSHOT',
      'No published snapshot is available for this scope.'
    );
  }
  async catalog(requestedScope?: string) {
    const scope = requestedScope ?? this.settings.DEFAULT_SCOPE_KEY;
    return this.repository.read(async (db) => {
      if (!(await db.scopeExists(scope))) {
        if (!requestedScope) this.noSnapshot();
        throw new ApiError(404, 'UNKNOWN_SCOPE', 'Unknown scope.');
      }
      const aliases = await db.aliases(scope);
      if (!aliases.length) this.noSnapshot();
      const releases = await db.releases(scope);
      const sources = await db.sources(
        scope,
        releases.map((r) => r.id)
      );
      const metrics = await db.metrics(releases.map((release) => release.config));
      const verified = sources
        .map((s) => s.verified_at)
        .filter(Boolean)
        .map((value) => new Date(String(value)).toISOString())
        .sort();
      return {
        scope_key: scope,
        sources: sources.map((source) => {
          const feeds = source.provider_availability as {
            status: string;
            start: string | null;
            end_exclusive: string | null;
          }[];
          const intervals = source.ingested_intervals as { start: string; end_exclusive: string }[];
          return {
            ...source,
            // A single interval is only claimed when the inventory has exactly one interval.
            provider_available_interval:
              feeds.length === 1
                ? { start: feeds[0].start, end_exclusive: feeds[0].end_exclusive }
                : null,
            ingested_interval:
              intervals.length === 1
                ? { start: intervals[0].start, end_exclusive: intervals[0].end_exclusive }
                : null,
            availability_status:
              feeds.length === 1 ? feeds[0].status : feeds.length ? 'multiple_feeds' : 'unknown'
          };
        }),
        metrics,
        releases: releases.map((r) => this.publicRelease(r)),
        release_aliases: aliases,
        limits: {
          max_aoi_vertices: this.settings.MAX_AOI_VERTICES,
          max_aoi_area_km2: this.settings.MAX_AOI_AREA_KM2,
          max_evidence_cell_days: this.settings.MAX_EVIDENCE_CELL_DAYS,
          max_points_per_page: this.settings.MAX_POINTS_PER_PAGE
        },
        verified_at: verified.at(-1) ?? null
      };
    });
  }
  private publicRelease(release: Release) {
    const { config, ...publicFields } = release;
    return {
      ...publicFields,
      configuration_digest: release.config_sha256,
      manifest_digest:
        typeof config.manifest_sha256 === 'string' && /^[0-9a-f]{64}$/.test(config.manifest_sha256)
          ? config.manifest_sha256
          : null
    };
  }
  private change(row: JsonRow) {
    return {
      reason: row.reason,
      revision_records: row.revision_records,
      affected_interval: { start: row.start, end_exclusive: row.end_exclusive },
      summary: `${row.revision_records} revision record(s): ${row.reason}.`
    };
  }
  async release(id: string, query: ReleaseQuery) {
    const membership = query.membership ?? 'partitions';
    const limit = Number(query.limit ?? 50);
    const binding = { release_id: id, membership, limit };
    const after = query.cursor ? this.cursors.decode(query.cursor, binding) : [];
    return this.repository.read(async (db) => {
      const release = await db.release(id);
      if (!release) throw new ApiError(404, 'RELEASE_NOT_FOUND', 'Published release not found.');
      const counts = await db.counts(id);
      const composition = await db.composition(id);
      const changes = await db.changeSummary(id);
      const rows = await db.members(id, membership, after, limit + 1);
      const more = rows.length > limit;
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      const position = last
        ? membership === 'partitions'
          ? [String(last.series_key), String(last.partition_key)]
          : [String(last.asset_id), String(last.role)]
        : [];
      return {
        ...this.publicRelease(release),
        validation_status: 'validated',
        partition_counts: counts,
        source_composition: composition,
        change_summary: changes.map((row) => this.change(row)),
        membership: {
          kind: membership,
          items,
          returned: items.length,
          next_cursor: more ? this.cursors.encode({ ...binding, after: position }) : null
        }
      };
    });
  }
  async updates(query: UpdatesQuery) {
    return this.repository.read(async (db) => {
      if (!(await db.scopeExists(query.scope_key)))
        throw new ApiError(404, 'UNKNOWN_SCOPE', 'Unknown scope.');
      const baseline = query.after_release_id
        ? await db.release(query.after_release_id)
        : undefined;
      if (query.after_release_id && !baseline)
        throw new ApiError(404, 'RELEASE_NOT_FOUND', 'Published baseline release not found.');
      if (
        baseline &&
        (baseline.scope_key !== query.scope_key ||
          (query.component && baseline.dataset_kind !== query.component))
      ) {
        throw new ApiError(
          422,
          'INCOMPATIBLE_BASELINE',
          'The baseline belongs to another scope or component.'
        );
      }
      const current = await db.aliases(
        query.scope_key,
        query.component ?? baseline?.dataset_kind ?? null,
        query.alias ?? null
      );
      if (!current.length) {
        if (!(await db.aliases(query.scope_key)).length) this.noSnapshot();
        throw new ApiError(
          422,
          'UNKNOWN_RELEASE_FILTER',
          'No published alias matches these filters.'
        );
      }
      const hasUpdates = !!baseline && current.some((a) => a.release_id !== baseline.id);
      let ids: string[] = [];
      let historyComplete = true;
      if (baseline && hasUpdates) {
        // Follow each selected alias independently to avoid mixing unrelated release histories.
        for (const alias of current.filter((a) => a.release_id !== baseline.id)) {
          const chain = await db.ancestry(alias.release_id, baseline);
          const found = chain.some((r) => r.id === baseline.id);
          historyComplete = historyComplete && found;
          ids.push(
            ...(found
              ? chain.filter((r) => r.id !== baseline.id).map((r) => r.id)
              : [alias.release_id])
          );
        }
      }
      ids = [...new Set(ids)];
      return {
        scope_key: query.scope_key,
        current,
        has_updates: hasUpdates,
        comparison: baseline ? 'compared' : 'baseline_not_provided',
        history_complete: historyComplete,
        changes: ids.length ? (await db.changes(ids)).map((row) => this.change(row)) : [],
        checked_at: new Date().toISOString()
      };
    });
  }
  async ready() {
    await this.catalog();
    return {
      status: 'ok',
      service: 'firebridge-api',
      checks: { database: 'ready', catalog: 'ready' }
    };
  }
}
