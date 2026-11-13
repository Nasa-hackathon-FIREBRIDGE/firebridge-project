CREATE SCHEMA "firebridge";

CREATE TABLE "firebridge"."sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "platform" TEXT,
    "instrument" TEXT,
    "product" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "processing_stream" TEXT NOT NULL,
    "documentation_url" TEXT NOT NULL,
    "citation" TEXT NOT NULL,
    "license_info" TEXT NOT NULL,
    "native_resolution_m" DOUBLE PRECISION,
    "schema_version" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sources_kind_check" CHECK ("kind" IN ('hotspots', 'fire_mask', 'geolocation', 'land_cover', 'imagery', 'weather', 'news', 'incident_report')),
    CONSTRAINT "sources_native_resolution_m_check" CHECK ("native_resolution_m" IS NULL OR "native_resolution_m" > 0),
    CONSTRAINT "sources_documentation_url_check" CHECK ("documentation_url" ~ '^https?://')
);

CREATE INDEX "sources_kind_idx" ON "firebridge"."sources"("kind");
CREATE INDEX "sources_provider_idx" ON "firebridge"."sources"("provider");
