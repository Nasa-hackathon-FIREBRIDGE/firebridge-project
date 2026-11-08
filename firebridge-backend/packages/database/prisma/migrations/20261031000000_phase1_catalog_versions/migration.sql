-- Phase 1 catalogue and data versions, with their required inventory dependencies.
-- Additive migration: sources and the initial HealthCheck table are preserved.
-- No provider data or published release is inserted by this migration.
BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
SET LOCAL search_path = firebridge, public;

CREATE TABLE assets (
    id uuid PRIMARY KEY,
    source_id text NOT NULL REFERENCES sources(id),
    native_key text NOT NULL,
    revision text NOT NULL,
    source_url text NOT NULL,
    storage_uri text NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    byte_size bigint NOT NULL CHECK (byte_size >= 0),
    time_start timestamptz,
    time_end timestamptz,
    footprint geometry(MultiPolygon,4326),
    retrieved_at timestamptz NOT NULL,
    validation_status text NOT NULL CHECK (validation_status IN ('pending','accepted','quarantined')),
    metadata jsonb NOT NULL DEFAULT '{}',
    UNIQUE(source_id,native_key,revision,sha256),
    UNIQUE(id,source_id),
    CHECK (time_end IS NULL OR time_start IS NULL OR time_end >= time_start)
);

CREATE TABLE data_releases (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    status text NOT NULL CHECK (status IN ('draft','validated','published','retired')),
    stream text NOT NULL CHECK (stream IN ('retrospective','provisional','experiment')),
    code_version text NOT NULL,
    config jsonb NOT NULL,
    config_sha256 text NOT NULL,
    manifest_uri text NOT NULL,
    parent_release_id uuid REFERENCES data_releases(id),
    dataset_kind text NOT NULL CHECK (dataset_kind IN ('satellite','weather','reports')),
    scope_key text NOT NULL,
    observation_cutoff timestamptz NOT NULL,
    validation_report_uri text,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE TABLE release_assets (
    release_id uuid NOT NULL REFERENCES data_releases(id),
    asset_id uuid NOT NULL REFERENCES assets(id),
    role text NOT NULL,
    PRIMARY KEY(release_id,asset_id,role)
);

CREATE TABLE pipeline_runs (
    id uuid PRIMARY KEY,
    release_id uuid REFERENCES data_releases(id),
    stage text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
    code_version text NOT NULL,
    config jsonb NOT NULL,
    input_manifest_uri text NOT NULL,
    output_manifest_uri text,
    started_at timestamptz,
    finished_at timestamptz,
    error_code text,
    log_uri text
);

CREATE TABLE areas (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    version text NOT NULL,
    geom geometry(MultiPolygon,4326) NOT NULL,
    geometry_sha256 text NOT NULL,
    display_timezone text NOT NULL,
    provenance text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(geometry_sha256,version),
    CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom))
);

CREATE TABLE grids (
    id text PRIMARY KEY,
    version text NOT NULL,
    projection_srid integer NOT NULL,
    cell_size_m double precision NOT NULL CHECK (cell_size_m > 0),
    origin_x_m double precision NOT NULL,
    origin_y_m double precision NOT NULL,
    supported_extent geometry(MultiPolygon,4326) NOT NULL,
    land_mask_asset_id uuid NOT NULL REFERENCES assets(id),
    construction_spec jsonb NOT NULL
);

CREATE TABLE metric_definitions (
    id text PRIMARY KEY,
    version text NOT NULL,
    unit text NOT NULL,
    family text NOT NULL CHECK (family IN ('native_detections','source_response','harmonized_response')),
    description text NOT NULL,
    definition jsonb NOT NULL,
    requires_masks boolean NOT NULL,
    requires_model boolean NOT NULL
);

CREATE TABLE ingestion_feeds (
    id text PRIMARY KEY,
    provider text NOT NULL,
    adapter text NOT NULL,
    adapter_version text NOT NULL,
    endpoint_template text NOT NULL,
    credential_ref text,
    rate_limit_group text NOT NULL,
    capability_spec jsonb NOT NULL,
    state text NOT NULL CHECK (state IN ('active','paused','retired','unverified')),
    verified_at timestamptz
);

CREATE TABLE feed_sources (
    feed_id text NOT NULL REFERENCES ingestion_feeds(id),
    source_id text NOT NULL REFERENCES sources(id),
    selector jsonb NOT NULL,
    PRIMARY KEY(feed_id,source_id)
);

CREATE TABLE source_availability (
    feed_id text NOT NULL,
    source_id text NOT NULL,
    checked_at timestamptz NOT NULL,
    available_start timestamptz,
    available_end_exclusive timestamptz,
    status text NOT NULL CHECK (status IN ('available','partial','unavailable','unknown','retired')),
    evidence_asset_id uuid REFERENCES assets(id),
    detail jsonb NOT NULL,
    PRIMARY KEY(feed_id,source_id,checked_at),
    FOREIGN KEY(feed_id,source_id) REFERENCES feed_sources(feed_id,source_id),
    CHECK (available_end_exclusive IS NULL OR available_start IS NULL OR available_end_exclusive > available_start)
);

CREATE TABLE ingestion_subscriptions (
    id uuid PRIMARY KEY,
    feed_id text NOT NULL REFERENCES ingestion_feeds(id),
    area_id uuid NOT NULL REFERENCES areas(id),
    scope_key text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('backfill','incremental','reconciliation')),
    interval_seconds integer NOT NULL CHECK (interval_seconds > 0),
    overlap_seconds integer NOT NULL CHECK (overlap_seconds >= 0),
    history_start timestamptz NOT NULL,
    fixed_end_exclusive timestamptz,
    request_config jsonb NOT NULL,
    config_sha256 text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    next_due_at timestamptz,
    lease_owner text,
    lease_expires_at timestamptz,
    UNIQUE(feed_id,scope_key,mode,config_sha256),
    CHECK (fixed_end_exclusive IS NULL OR fixed_end_exclusive > history_start)
);

CREATE TABLE data_partitions (
    id uuid PRIMARY KEY,
    pipeline_run_id uuid NOT NULL REFERENCES pipeline_runs(id),
    kind text NOT NULL CHECK (kind IN ('detections','observations','features','daily_activity','weather','reports','tiles')),
    series_key text NOT NULL,
    partition_key text NOT NULL,
    support_spec jsonb NOT NULL,
    storage_uri text NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    input_manifest_uri text NOT NULL,
    schema_version text NOT NULL,
    row_count bigint NOT NULL CHECK (row_count >= 0),
    serving_complete boolean NOT NULL,
    validation_status text NOT NULL CHECK (validation_status IN ('pending','validated','quarantined')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(series_key,partition_key,sha256),
    UNIQUE(id,series_key,partition_key)
);

CREATE TABLE release_partitions (
    release_id uuid NOT NULL REFERENCES data_releases(id),
    series_key text NOT NULL,
    partition_key text NOT NULL,
    partition_id uuid NOT NULL,
    PRIMARY KEY(release_id,series_key,partition_key),
    FOREIGN KEY(partition_id,series_key,partition_key) REFERENCES data_partitions(id,series_key,partition_key)
);

CREATE TABLE release_aliases (
    alias text NOT NULL,
    scope_key text NOT NULL,
    release_id uuid NOT NULL REFERENCES data_releases(id),
    generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
    updated_at timestamptz NOT NULL,
    PRIMARY KEY(alias,scope_key)
);

CREATE TABLE release_changes (
    id uuid PRIMARY KEY,
    from_release_id uuid NOT NULL REFERENCES data_releases(id),
    to_release_id uuid NOT NULL REFERENCES data_releases(id),
    series_key text NOT NULL,
    affected_start timestamptz NOT NULL,
    affected_end_exclusive timestamptz NOT NULL,
    affected_area geometry(MultiPolygon,4326),
    reason text NOT NULL CHECK (reason IN ('new_data','late_data','provider_revision','standard_replacement','retraction','method_change','weather_revision','report_revision')),
    diff_manifest_uri text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (from_release_id <> to_release_id),
    CHECK (affected_end_exclusive > affected_start)
);

CREATE INDEX assets_footprint_gist ON assets USING gist(footprint);
CREATE INDEX areas_geom_gist ON areas USING gist(geom);
CREATE INDEX subscriptions_due ON ingestion_subscriptions(next_due_at) WHERE enabled;
CREATE INDEX partitions_key ON data_partitions(series_key,partition_key,created_at DESC);
CREATE INDEX source_availability_recent ON source_availability(feed_id,source_id,checked_at DESC);
CREATE INDEX release_changes_to ON release_changes(to_release_id);
CREATE INDEX data_releases_scope_status ON data_releases(scope_key,status);
CREATE INDEX release_aliases_release ON release_aliases(release_id);
COMMIT;
