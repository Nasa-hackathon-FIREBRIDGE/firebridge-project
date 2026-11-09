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

HTTPS uses the patched frontend Nginx image as a separate proxy container. Its
master can read the root-owned certificate; request workers drop to UID 101.
Both Nginx containers use a read-only filesystem, restricted capabilities and
no Docker socket. TLS 1.2/1.3 is enabled, HTTP redirects to HTTPS, and public
admin/API-doc routes are blocked. CI validates the proxy with throwaway TLS files.

Before first activation, an administrator runs `deploy/setup_tls.sh` as root on
the server (DNS for apex and www must already point to it and port 80 be free).
It installs Certbot, obtains a certificate using a temporary HTTP challenge
server and enables `certbot.timer`. Subsequent renewals use the proxy's webroot
challenge route and reload Nginx through a deploy hook without stopping the app.
No contact email is registered; add an operator email using `certbot update_account`.
Check renewal after activation with `certbot renew --dry-run --run-deploy-hooks`.
Certificates/private keys stay in `/etc/letsencrypt` on the host and never enter
GitHub Actions or image builds. See the [Certbot renewal guide](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates).

## Existing server: daily use

Push changes to `staging`. GitHub Actions validates code, tests against disposable
PostGIS/Redis, builds images, scans source credentials and every runtime image for
HIGH/CRITICAL vulnerabilities (including unfixed findings), tests the containers,
publishes immutable GHCR digests, then deploys. Failure before activation leaves
the running release in place. Pull requests run checks without deployment.

The GitHub environment `webapp-production` holds `DEPLOY_SSH_KEY` and
`DEPLOY_KNOWN_HOSTS`; its variable `DEPLOY_HOST` is the VPS IP. Repository variable
`WEBAPP_DEPLOY_ENABLED=true` enables deployment. The SSH key can invoke only the
image-transfer/status/activation gateway, not a shell or the data platform.
`staging` is the deployment branch; pushing `main` does not deploy this workflow.

Administrator commands (on the VPS):

```bash
cd /opt/firebridge/webapp
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs --tail=100 api worker proxy
curl --fail http://127.0.0.1:13000/api/v1/health/ready
cat deployment.json
systemctl list-timers certbot.timer
certbot renew --dry-run --run-deploy-hooks
```

Credentials live in root-only `runtime.env` and `private-config.json`; Redis's
separate config is readable only by UID 999. Never send these files in chat,
commit them, expose PostgreSQL publicly, or put DATABASE_URL into Vite variables.
The API and worker connect to `db:5432/firebridge` over `firebridge_default`, using
`firebridge_webapp`. Prisma uses `schema=public` in the connection URL so PostGIS
functions resolve; all application tables are explicitly mapped to `firebridge`. The browser calls `/api/v1` through the HTTPS proxy and
never connects to PostgreSQL. The backend pool is capped at five connections
per process; the runtime role has a total connection limit of twenty.

Rollback is an administrator/CI gateway operation using an already loaded
revision: `rollback <40-character-sha>` over the restricted deploy key. The gateway
retains the previous image references and takes a database backup before activation.
Schema additions are deliberately not reversed by image rollback.

## Rebuild the setup on another server

1. Provision the data platform first: private PostGIS, `firebridge_default`, pinned
   schema `980a58006432cea3214b8d0b492cf4781322bd1d`, and at least one real published
   catalogue release. A lake download alone is insufficient for application readiness.
2. Install Docker/Compose, configure key-only SSH/UFW, and point A records for
   `astramind.solutions` and `www.astramind.solutions` to the server. Ports 80/443
   must be reachable; PostgreSQL, Redis, Airflow and pgAdmin stay private.
3. Copy this reviewed source tree to `/opt/firebridge/webapp/installer`. Back up
   the database using the data platform's backup tool before applying additions.
   Run as root from that tree:
   `python3 deploy/prepare_database.py --stack /opt/firebridge/current/scripts/stack.sh --database firebridge`.
   This verifies all pipeline migration checksums and applies only the four
   additional application migrations. Use the actual data-platform stack script
   if it differs. Never run the application's full Prisma baseline on the data DB.
4. Generate a dedicated Ed25519 CI key outside Git. Copy only its public key to
   the server and run `python3 deploy/provision_server.py --ci-public-key /path/to/ci.pub`.
   This generates private credentials, grants the limited role, installs static
   Compose/proxy/gateway files, creates the restricted deploy account, initializes
   owned volumes and allows 80/443. It does not replace/restart data services.
5. Run `bash deploy/setup_tls.sh` as root before first activation. Install the CI
   private key and verified SSH host keys in the GitHub environment described above.
6. Enable `WEBAPP_DEPLOY_ENABLED` and push `staging`; wait for all jobs, public
   readiness and browser verification. Test certificate renewal after activation.

Infrastructure configuration changes require administrator review/copy to the
server. Routine CD updates images only. Do not attach the frontend or Redis to
the database network, grant the backend owner credentials, or prune shared volumes.

Redis uses the explicit jobs-network alias `firebridge-webapp-redis`, avoiding
collisions with any `redis` service on an attached external data/test network.
