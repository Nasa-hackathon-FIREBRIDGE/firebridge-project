import type { SnapshotDatabase, SqlReader } from './database.js';
import { nativeAreaSql } from '@firebridge/contracts';

export type NativeAnalysis = {
  id: string;
  area_id: string;
  release_id: string;
  start_date: string;
  end_date_exclusive: string;
  time_basis: string;
  metric_key: string;
  grid_id: string | null;
  selection_policy: string;
  weighting_version: string;
  status: string;
  request_spec: Record<string, unknown>;
  cache_key: string;
  geometry_sha256: string;
  release_status: string;
  published_at: string | null;
  observation_cutoff: string;
  scope_key: string;
  code_version: string;
  config_sha256: string;
};
export type NativePartition = {
  id: string;
  series_key: string;
  partition_key: string;
  sha256: string;
  row_count: string;
  stored_rows: string;
  serving_complete: boolean;
  validation_status: string;
  support_spec: Record<string, unknown>;
};
export type NativeSource = {
  source_id: string;
  platform: string | null;
  product: string;
  collection: string;
  processing_stream: string;
  citation: string;
  license_info: string;
};
export type Component = { component: string; release_id: string | null; status: string };
export type NativeFilter = {
  partitions: string[];
  sources: string[];
  levels: string[];
  area: string;
  start: string;
  end: string;
  bbox: number[] | null;
};

// Every statement runs in the same read-only snapshot. No alias is re-resolved here.
export class NativeResultsRepository {
  constructor(private database: SnapshotDatabase) {}
  read<T>(fn: (reader: NativeResultsReader) => Promise<T>) {
    return this.database.snapshot((db) => fn(new NativeResultsReader(db)));
  }
}

export class NativeResultsReader {
  constructor(private db: SqlReader) {}
  async analysis(id: string) {
    const rows = await this.db.query<NativeAnalysis>(
      `
      SELECT a.id,a.area_id,a.release_id,a.start_date::text,a.end_date_exclusive::text,
        a.time_basis,a.metric_key,a.grid_id,a.selection_policy,a.weighting_version,a.status,
        a.request_spec,a.cache_key,g.geometry_sha256,r.status AS release_status,r.published_at,
        r.observation_cutoff,r.scope_key,r.code_version,r.config_sha256
      FROM firebridge.analyses a JOIN firebridge.areas g ON g.id=a.area_id
      JOIN firebridge.data_releases r ON r.id=a.release_id WHERE a.id=$1::uuid`,
      [id]
    );
    return rows[0];
  }
  components(id: string) {
    return this.db.query<Component>(
      `SELECT component,release_id,status FROM firebridge.analysis_components
      WHERE analysis_id=$1::uuid ORDER BY component`,
      [id]
    );
  }
  partitions(release: string) {
    return this.db.query<NativePartition>(
      `
      SELECT p.id,rp.series_key,rp.partition_key,p.sha256,p.row_count::text,
        (SELECT count(*)::text FROM firebridge.partition_detections pd WHERE pd.partition_id=p.id) AS stored_rows,
        p.serving_complete,p.validation_status,p.support_spec
      FROM firebridge.release_partitions rp JOIN firebridge.data_partitions p ON p.id=rp.partition_id
      WHERE rp.release_id=$1::uuid AND p.kind='detections'
      ORDER BY rp.series_key,rp.partition_key LIMIT 10001`,
      [release]
    );
  }
  sources(ids: string[]) {
    return this.db.query<NativeSource>(
      `SELECT id AS source_id,platform,product,collection,
      processing_stream,citation,license_info FROM firebridge.sources WHERE id=ANY($1::text[])
      ORDER BY id`,
      [ids]
    );
  }
  private selection(filter: NativeFilter) {
    return {
      params: [
        filter.partitions,
        filter.sources,
        filter.levels,
        filter.area,
        filter.start,
        filter.end,
        filter.bbox
      ],
      sql: `FROM firebridge.detections d JOIN firebridge.areas area ON area.id=$4::uuid
        WHERE EXISTS(SELECT 1 FROM firebridge.partition_detections pd
          WHERE pd.detection_id=d.id AND pd.partition_id=ANY($1::uuid[]))
        AND d.source_id=ANY($2::text[]) AND d.processing_level=ANY($3::text[])
        AND d.acquired_at >= $5::timestamptz AND d.acquired_at < $6::timestamptz
        AND ST_Covers(${nativeAreaSql('area')},d.geom)
        AND ($7::double precision[] IS NULL OR ST_Covers(
          ST_MakeEnvelope(($7::double precision[])[1],($7::double precision[])[2],
            ($7::double precision[])[3],($7::double precision[])[4],4326),d.geom))`
    };
  }
  detections(filter: NativeFilter, after: string[], limit: number) {
    const { sql, params } = this.selection(filter);
    return this.db.query<Record<string, unknown>>(
      `
      SELECT d.id::text AS detection_id,d.asset_id,d.source_id,s.platform,
        to_char(d.acquired_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acquired_at,
        ST_X(d.geom) AS longitude,ST_Y(d.geom) AS latitude,d.confidence_raw,d.confidence_scheme,
        d.type_raw,d.day_night,d.frp_mw,d.brightness_bands,d.processing_level
      ${sql.replace('WHERE EXISTS', 'JOIN firebridge.sources s ON s.id=d.source_id WHERE EXISTS')}
      AND ($8::timestamptz IS NULL OR (d.acquired_at,d.id)>($8::timestamptz,$9::bigint))
      ORDER BY d.acquired_at,d.id LIMIT $10`,
      [...params, after[0] ?? null, after[1] ?? null, limit]
    );
  }
  counts(filter: NativeFilter, resolution: 'day' | 'week' | 'month' = 'day') {
    const { sql, params } = this.selection(filter);
    return this.db.query<{ source_id: string; period: string; count: string }>(
      `
      SELECT d.source_id,to_char(date_trunc($8,d.acquired_at AT TIME ZONE 'UTC'),'YYYY-MM-DD') AS period,
        count(*)::text AS count ${sql} GROUP BY d.source_id,period ORDER BY period,d.source_id`,
      [...params, resolution]
    );
  }
  assets(releases: string[], asset: string | null, after: string[], limit: number) {
    return this.db.query<Record<string, unknown>>(
      `
      WITH inputs AS (
        SELECT ra.release_id,ra.asset_id,ra.role FROM firebridge.release_assets ra
        WHERE ra.release_id=ANY($1::uuid[])
        UNION
        SELECT DISTINCT rp.release_id,d.asset_id,'canonical_record' AS role
        FROM firebridge.release_partitions rp JOIN firebridge.partition_detections pd ON pd.partition_id=rp.partition_id
        JOIN firebridge.detections d ON d.id=pd.detection_id WHERE rp.release_id=ANY($1::uuid[])
      )
      SELECT a.id AS asset_id,i.release_id,i.role,a.source_id,a.sha256,a.byte_size::text,
        a.retrieved_at,a.validation_status,s.product,s.collection,s.processing_stream,s.citation,s.license_info,
        i.release_id::text || ':' || i.role AS position
      FROM inputs i JOIN firebridge.assets a ON a.id=i.asset_id JOIN firebridge.sources s ON s.id=a.source_id
      WHERE ($2::uuid IS NULL OR a.id=$2::uuid)
        AND ($3::text IS NULL OR (a.id::text,i.release_id::text || ':' || i.role)>($3,$4))
      ORDER BY a.id::text,i.release_id::text || ':' || i.role LIMIT $5`,
      [releases, asset, after[0] ?? null, after[1] ?? null, limit]
    );
  }
  releases(ids: string[]) {
    return this.db.query<Record<string, unknown>>(
      `SELECT id,name,scope_key,dataset_kind,stream,
      published_at,code_version,config_sha256 FROM firebridge.data_releases
      WHERE id=ANY($1::uuid[]) AND status='published' AND published_at IS NOT NULL ORDER BY id`,
      [ids]
    );
  }
}
