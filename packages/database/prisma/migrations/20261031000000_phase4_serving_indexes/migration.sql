-- Additive indexes only. Existing GiST detections_geom_gist and partition
-- forward/reverse indexes already support spatial serving and release scope.
-- Reviewed against schema v2. No application data is changed by this migration.
CREATE INDEX IF NOT EXISTS jobs_analysis_requester
  ON firebridge.api_jobs (analysis_id, requested_by) WHERE kind = 'analysis';
CREATE INDEX IF NOT EXISTS jobs_export_active
  ON firebridge.api_jobs (requested_by, status, created_at) WHERE kind = 'export';
CREATE INDEX IF NOT EXISTS jobs_export_recent
  ON firebridge.api_jobs (requested_by, created_at) WHERE kind = 'export';
CREATE INDEX IF NOT EXISTS jobs_export_expiry
  ON firebridge.api_jobs (expires_at) WHERE kind = 'export' AND result_manifest_uri IS NOT NULL;
