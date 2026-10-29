# FIREBRIDGE API

This document describes the expected API structure for the FIREBRIDGE backend.

## API root

- Base URL: `/api/v1`
- Health endpoints: `/health/live`, `/health/ready`

## Resource groups

- Health
- Catalog
- Sources
- Releases
- Updates
- Areas
- Analyses
- Detections
- Tiles
- Cells
- Weather
- Reports
- Provenance
- Explanations
- Exports
- Jobs
- Administration and ingestion

## Current implementation state

The repository contains the foundation and route scaffolding for the resource groups above. Sources now supports validated creation and cursor-paginated listing backed by Prisma; other feature-level business logic remains scaffolded where not implemented.

## Sources

- `GET /sources?kind=hotspots&provider=NASA&limit=50&cursor=<source-id>` lists sources in ascending ID order. `kind` and `provider` are optional exact filters; `limit` defaults to 50 and is capped at 100. A non-null `data.nextCursor` can be passed as `cursor` to fetch the next page.
- `POST /sources` creates a source. The JSON body requires `name`, `provider`, `kind`, `product`, `collection`, `processingStream`, `documentationUrl`, `citation`, `licenseInfo`, and `schemaVersion`. `kind` is one of `hotspots`, `fire_mask`, `geolocation`, `land_cover`, `imagery`, `weather`, `news`, or `incident_report`. `platform`, `instrument`, `nativeResolutionM`, and object-valued `metadata` are optional.
- Both endpoints return the common `{ status, message, data }` shape. Invalid input returns HTTP 400.

The additive migration for the Sources table is in `packages/database/prisma/migrations/20261029030000_add_sources`. It creates the `firebridge` schema and table, matching the design artifact's intended schema. It has not been applied. Apply it only after review and through the approved database migration process.

## Example response contract

```json
{
  "status": "planned",
  "message": "This endpoint is scaffolded and not yet implemented.",
  "data": null
}
```
