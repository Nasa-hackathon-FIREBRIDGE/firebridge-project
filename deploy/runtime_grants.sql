-- Runtime account: no ownership, schema DDL, source-data writes or ingestion control.
ALTER ROLE firebridge_webapp NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
ALTER ROLE firebridge_webapp SET statement_timeout='15s';
ALTER ROLE firebridge_webapp SET idle_in_transaction_session_timeout='15s';
ALTER ROLE firebridge_webapp SET timezone='UTC';
ALTER ROLE firebridge_webapp SET search_path=firebridge,public;
GRANT USAGE ON SCHEMA firebridge,serving,public TO firebridge_webapp;
GRANT SELECT ON ALL TABLES IN SCHEMA serving TO firebridge_webapp;
GRANT SELECT ON firebridge.ai_explanations,firebridge.analyses,firebridge.analysis_components,firebridge.analysis_event_links,firebridge.analysis_request_keys,firebridge.api_jobs,firebridge.area_cells,firebridge.areas,firebridge.assets,firebridge.calendar_periods,firebridge.daily_activity,firebridge.data_partitions,firebridge.data_releases,firebridge.detections,firebridge.evaluations,firebridge.evidence_snapshots,firebridge.explanation_request_keys,firebridge.feed_sources,firebridge.fetch_assets,firebridge.fetch_runs,firebridge.grid_cells,firebridge.grids,firebridge.ingestion_checkpoints,firebridge.ingestion_feeds,firebridge.ingestion_gaps,firebridge.ingestion_subscriptions,firebridge.metric_definitions,firebridge.model_versions,firebridge.news_reports,firebridge.observation_assets,firebridge.observations,firebridge.outbox_events,firebridge.partition_detections,firebridge.pipeline_runs,firebridge.predictions,firebridge.quality_issues,firebridge.release_aliases,firebridge.release_assets,firebridge.release_changes,firebridge.release_partitions,firebridge.reported_events,firebridge.source_availability,firebridge.sources,firebridge.weather_locations,firebridge.weather_summaries,firebridge.weather_values TO firebridge_webapp;
GRANT INSERT,UPDATE ON firebridge.ai_explanations,firebridge.analyses,firebridge.analysis_components,firebridge.analysis_request_keys,firebridge.api_jobs,firebridge.evidence_snapshots,firebridge.explanation_request_keys,firebridge.outbox_events TO firebridge_webapp;
GRANT INSERT ON firebridge.areas,firebridge.metric_definitions TO firebridge_webapp;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO firebridge_webapp', current_database()); END $$;
