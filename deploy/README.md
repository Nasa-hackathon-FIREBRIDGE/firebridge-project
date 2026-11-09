# Production deployment

Domain: https://astramind.solutions. The production branch is `staging`.

The webapp has a separate Compose project at `/opt/firebridge/webapp`. It reuses
PostGIS through `firebridge_default`; it does not start or replace a database.
API and worker use a dedicated non-owner role with read access and explicit
application-table write grants. Raw detections/publication tables are not writable.
Redis has authentication, durable storage, no host port and an internal job network.
Only the proxy publishes HTTP/HTTPS; API administration is loopback-only on 13000.

`runtime.env`, `redis.conf`, registry/deployment keys and database passwords stay
outside Git. The server configuration is installed by an administrator. Routine
CI/CD transfers verified images and changes their revision, not credentials or the
data-platform Compose stack. All application images run with reduced privileges.

Checks include lint, types/build, unit/UI tests, PostgreSQL/Redis integration,
dependency audit, secret scanning, image vulnerability scans and actual-container
health checks. A failed readiness check prevents activation. Existing webapp images
are retained for rollback; database schemas are never automatically downgraded.

The separate full-history acquisition remains owned by the data platform. The
webapp consumes published subsets; a completed source download is not automatically
a PostgreSQL release. No synthetic observations are seeded into production.
