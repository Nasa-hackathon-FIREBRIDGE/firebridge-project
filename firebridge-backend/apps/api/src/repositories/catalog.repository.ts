import type { SnapshotDatabase, SqlReader } from './database.js';

export type Release = {
  id: string;
  name: string;
  dataset_kind: string;
  stream: string;
  scope_key: string;
  parent_release_id: string | null;
  published_at: string;
  observation_cutoff: string;
  code_version: string;
  config_sha256: string;
  config: { metric_ids?: string[]; grid_ids?: string[]; manifest_sha256?: string };
};
export type Alias = {
  alias: string;
  release_id: string;
  generation: string;
  published_at: string;
  dataset_kind: string;
};
export type JsonRow = Record<string, unknown>;

export class CatalogRepository {
  constructor(private database: SnapshotDatabase) {}
  read<T>(fn: (reader: CatalogReader) => Promise<T>) {
    return this.database.snapshot((db) => fn(new CatalogReader(db)));
  }
}
export class CatalogReader {
  constructor(private db: SqlReader) {}
  async scopeExists(scope: string) {
    const rows = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM firebridge.data_releases WHERE scope_key=$1
        UNION ALL SELECT 1 FROM firebridge.ingestion_subscriptions WHERE scope_key=$1) AS exists`,
      [scope]
    );
    return rows[0].exists;
  }
  aliases(scope: string, component: string | null = null, alias: string | null = null) {
    return this.db.query<Alias>(
      `
      SELECT a.alias,a.release_id,a.generation::text,r.published_at,r.dataset_kind
      FROM firebridge.release_aliases a JOIN firebridge.data_releases r ON r.id=a.release_id
      WHERE a.scope_key=$1 AND r.scope_key=$1 AND r.status='published' AND r.published_at IS NOT NULL
        AND ($2::text IS NULL OR r.dataset_kind=$2) AND ($3::text IS NULL OR a.alias=$3)
      ORDER BY a.alias`,
      [scope, component, alias]
    );
  }
  releases(scope: string) {
    return this.db.query<Release>(
      `
      SELECT DISTINCT r.id,r.name,r.dataset_kind,r.stream,r.scope_key,r.parent_release_id,
        r.published_at,r.observation_cutoff,r.code_version,r.config_sha256,r.config
      FROM firebridge.data_releases r JOIN firebridge.release_aliases a ON a.release_id=r.id AND a.scope_key=r.scope_key
      WHERE r.scope_key=$1 AND r.status='published' AND r.published_at IS NOT NULL ORDER BY r.id`,
      [scope]
    );
  }
  async release(id: string) {
    const rows = await this.db.query<Release>(
      `
      SELECT id,name,dataset_kind,stream,scope_key,parent_release_id,published_at,observation_cutoff,
        code_version,config_sha256,config FROM firebridge.data_releases
      WHERE id=$1::uuid AND status='published' AND published_at IS NOT NULL`,
      [id]
    );
    return rows[0];
  }
  sources(scope: string, releaseIds: string[]) {
    return this.db.query<JsonRow>(
      `
      WITH membership AS (
        SELECT p.* FROM firebridge.release_partitions rp
        JOIN firebridge.data_partitions p ON p.id=rp.partition_id WHERE rp.release_id=ANY($2::uuid[])
      ), scope_sources AS (
        SELECT fs.source_id FROM firebridge.ingestion_subscriptions sub
        JOIN firebridge.feed_sources fs ON fs.feed_id=sub.feed_id WHERE sub.scope_key=$1
        UNION SELECT jsonb_array_elements_text(p.support_spec->'source_ids') FROM membership p
        UNION SELECT a.source_id FROM firebridge.release_assets ra JOIN firebridge.assets a ON a.id=ra.asset_id
          WHERE ra.release_id=ANY($2::uuid[])
      )
      SELECT s.id AS source_id,s.platform,s.instrument,s.product,s.collection,s.processing_stream,
        COALESCE(provider.feeds,'[]'::jsonb) AS provider_availability,
        COALESCE(local.intervals,'[]'::jsonb) AS ingested_intervals,
        provider.checked_at AS verified_at
      FROM firebridge.sources s JOIN scope_sources ss ON ss.source_id=s.id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('feed_id',a.feed_id,'status',a.status,
          'start',a.available_start,'end_exclusive',a.available_end_exclusive,'checked_at',a.checked_at)
          ORDER BY a.feed_id) AS feeds, max(a.checked_at) AS checked_at
        FROM (
          SELECT DISTINCT ON (av.feed_id) av.* FROM firebridge.source_availability av
          JOIN firebridge.ingestion_feeds f ON f.id=av.feed_id
          WHERE av.source_id=s.id AND f.verified_at IS NOT NULL AND f.state<>'unverified'
            AND EXISTS (SELECT 1 FROM firebridge.ingestion_subscriptions sub
              WHERE sub.feed_id=f.id AND sub.scope_key=$1)
          ORDER BY av.feed_id,av.checked_at DESC
        ) a
      ) provider ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT jsonb_build_object('start',p.support_spec->>'start',
          'end_exclusive',p.support_spec->>'end_exclusive','serving_complete',p.serving_complete))
          FILTER (WHERE p.support_spec->>'start' IS NOT NULL AND p.support_spec->>'end_exclusive' IS NOT NULL) AS intervals
        FROM membership p WHERE p.validation_status='validated' AND p.support_spec->'source_ids' ? s.id
      ) local ON true ORDER BY s.id`,
      [scope, releaseIds]
    );
  }
  metrics(configs: Release['config'][]) {
    return this.db.query<JsonRow>(
      `
      SELECT m.id,m.version,m.unit,m.family,m.description,m.requires_masks,m.requires_model,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('grid_id',g.id,'version',g.version,
          'geometry',ST_AsGeoJSON(g.supported_extent)::jsonb) ORDER BY g.id)
          FROM firebridge.grids g WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements($1::jsonb) config
            WHERE config->'metric_ids' ? m.id AND config->'grid_ids' ? g.id
          )),'[]'::jsonb) AS supported_extent
      FROM firebridge.metric_definitions m WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements($1::jsonb) config WHERE config->'metric_ids' ? m.id
      ) ORDER BY m.id`,
      [JSON.stringify(configs)]
    );
  }
  counts(id: string) {
    return this.db.query<JsonRow>(
      `
      SELECT p.kind,count(*)::int AS partitions,sum(p.row_count)::text AS row_count,
        bool_and(p.serving_complete) AS serving_complete
      FROM firebridge.release_partitions rp JOIN firebridge.data_partitions p ON p.id=rp.partition_id
      WHERE rp.release_id=$1::uuid GROUP BY p.kind ORDER BY p.kind`,
      [id]
    );
  }
  composition(id: string) {
    return this.db.query<JsonRow>(
      `
      WITH composition AS (
        SELECT DISTINCT jsonb_array_elements_text(p.support_spec->'source_ids') AS source_id,'record'::text AS role
        FROM firebridge.release_partitions rp JOIN firebridge.data_partitions p ON p.id=rp.partition_id
        WHERE rp.release_id=$1::uuid
        UNION SELECT a.source_id,'input' FROM firebridge.release_assets ra
        JOIN firebridge.assets a ON a.id=ra.asset_id WHERE ra.release_id=$1::uuid
      )
      SELECT s.id AS source_id,s.platform,s.product,s.collection,s.processing_stream,c.role
      FROM composition c JOIN firebridge.sources s ON s.id=c.source_id ORDER BY c.role,s.id`,
      [id]
    );
  }
  members(id: string, kind: 'partitions' | 'assets', after: string[], limit: number) {
    if (kind === 'assets')
      return this.db.query<JsonRow>(
        `
      SELECT a.id AS asset_id,ra.role,a.source_id,a.sha256,a.byte_size::text,a.validation_status
      FROM firebridge.release_assets ra JOIN firebridge.assets a ON a.id=ra.asset_id
      WHERE ra.release_id=$1::uuid AND ($2::text IS NULL OR (a.id::text,ra.role)>($2,$3))
      ORDER BY a.id::text,ra.role LIMIT $4`,
        [id, after[0] ?? null, after[1] ?? null, limit]
      );
    return this.db.query<JsonRow>(
      `
      SELECT rp.series_key,rp.partition_key,p.id AS partition_id,p.kind,p.sha256,p.row_count::text,
        p.serving_complete,p.validation_status,p.schema_version
      FROM firebridge.release_partitions rp JOIN firebridge.data_partitions p ON p.id=rp.partition_id
      WHERE rp.release_id=$1::uuid AND ($2::text IS NULL OR (rp.series_key,rp.partition_key)>($2,$3))
      ORDER BY rp.series_key,rp.partition_key LIMIT $4`,
      [id, after[0] ?? null, after[1] ?? null, limit]
    );
  }
  changeSummary(id: string) {
    return this.db.query<JsonRow>(
      `
      SELECT reason,count(*)::int AS revision_records,min(affected_start) AS start,
        max(affected_end_exclusive) AS end_exclusive FROM firebridge.release_changes
      WHERE to_release_id=$1::uuid GROUP BY reason ORDER BY reason`,
      [id]
    );
  }
  async ancestry(currentId: string, baseline: Release) {
    return this.db.query<{ id: string; parent_release_id: string | null }>(
      `
      WITH RECURSIVE chain AS (
        SELECT id,parent_release_id FROM firebridge.data_releases
        WHERE id=$1::uuid AND scope_key=$3 AND dataset_kind=$4
        UNION
        SELECT r.id,r.parent_release_id FROM firebridge.data_releases r JOIN chain c ON r.id=c.parent_release_id
        WHERE c.id<>$2::uuid AND r.status='published' AND r.scope_key=$3 AND r.dataset_kind=$4
      ) SELECT * FROM chain`,
      [currentId, baseline.id, baseline.scope_key, baseline.dataset_kind]
    );
  }
  changes(ids: string[]) {
    // Aggregate the revision ledger to keep UI polling responses bounded by reason.
    return this.db.query<JsonRow>(
      `
      SELECT reason,count(*)::int AS revision_records,min(affected_start) AS start,
        max(affected_end_exclusive) AS end_exclusive FROM firebridge.release_changes
      WHERE to_release_id=ANY($1::uuid[]) GROUP BY reason ORDER BY reason`,
      [ids]
    );
  }
}
