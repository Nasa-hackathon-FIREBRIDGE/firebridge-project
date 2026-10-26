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

The repository contains the foundation and route scaffolding for the resource groups above. The database, queue, middleware, and HTTP layers are in place, but feature-level business logic remains intentionally scaffolded and marked as planned where not implemented.

## Example response contract

```json
{
  "status": "planned",
  "message": "This endpoint is scaffolded and not yet implemented.",
  "data": null
}
```
