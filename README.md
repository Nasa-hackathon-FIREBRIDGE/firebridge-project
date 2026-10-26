# FIREBRIDGE

FIREBRIDGE is a modular monolith backend foundation for wildfire monitoring, analysis, and operational reporting. The project is organized as a TypeScript + Express API with supporting worker and shared package layers.

## Architecture overview

- `apps/api`: HTTP API layer, routing, request validation, controllers, middleware, and API documentation
- `apps/worker`: asynchronous processing and queue workers using BullMQ and Redis
- `packages/domain`: business entities and domain rules
- `packages/contracts`: shared interfaces and DTOs
- `packages/database`: Prisma schema and database layer
- `packages/integrations`: external provider adapters for satellite, weather, storage, and AI integrations
- `packages/observability`: logging and tracing helpers

## Implementation plan

1. Establish the workspace and shared TypeScript configuration.
2. Configure environment validation, logging, and application bootstrapping for the API.
3. Provide structured health endpoints and versioned routing for `/api/v1`.
4. Add controller/service skeletons for major resource groups: catalog, sources, releases, analyses, detections, weather, reports, exports, jobs, and admin.
5. Add middleware, error handling, and API documentation with OpenAPI.
6. Add worker infrastructure for Redis/BullMQ queue processing and background jobs.
7. Add database and Prisma foundation with PostGIS-ready schema stubs.
8. Document resource contracts and endpoint catalog for continued feature work.

## Local development

```bash
npm install
npm run dev:api
```

To bring up supporting infrastructure:

```bash
docker compose up -d postgres redis
```

## Notes

This repository intentionally includes architecture and skeleton implementation only where required to provide a solid base. Endpoints that are not yet implemented return a planned/501 response rather than fake success payloads.
