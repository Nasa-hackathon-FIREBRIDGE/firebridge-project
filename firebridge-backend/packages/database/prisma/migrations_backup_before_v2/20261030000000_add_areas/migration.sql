-- Migration: add areas table with PostGIS geometry support
-- The firebridge_schema_v2.sql design document defines the areas table as:
--   geom geometry(MultiPolygon,4326) NOT NULL
--   geometry_sha256 text NOT NULL
--   UNIQUE(geometry_sha256, version)
--   CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom))
-- This migration implements that specification.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS "firebridge"."areas" (
    "id"               TEXT                     NOT NULL,
    "name"             TEXT                     NOT NULL,
    "version"          TEXT                     NOT NULL,
    "geom"             geometry(MultiPolygon,4326) NOT NULL,
    "geometry_sha256"  TEXT                     NOT NULL,
    "display_timezone" TEXT                     NOT NULL,
    "provenance"       TEXT                     NOT NULL,
    "created_at"       TIMESTAMPTZ              NOT NULL DEFAULT now(),

    CONSTRAINT "areas_pkey"              PRIMARY KEY ("id"),
    CONSTRAINT "areas_geom_version_key"  UNIQUE ("geometry_sha256", "version"),
    CONSTRAINT "areas_geom_valid_check"  CHECK (ST_IsValid("geom") AND NOT ST_IsEmpty("geom"))
);

CREATE INDEX IF NOT EXISTS "areas_geom_gist" ON "firebridge"."areas" USING gist("geom");

