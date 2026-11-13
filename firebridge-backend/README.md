# FIREBRIDGE backend

Fastify API in TypeScript and a BullMQ worker. PostgreSQL/PostGIS stores the
data; Redis carries the job queues.

- `apps/api/src`: routes, controllers, services and repositories.
- `apps/worker/src`: dispatcher and asynchronous processing.
- `packages/contracts`: contracts shared with the frontend.
- `packages/database`: data access and application migrations.
- `docker-compose.yml`: definition of the local services.

See the [main README](../README.md) for the Docker build and the connection to
the data pipeline. The API generates its HTTP documentation under `/api-docs/`.
Private `.env` files are not included in the repository.
