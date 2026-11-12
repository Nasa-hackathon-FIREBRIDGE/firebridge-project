# FIREBRIDGE

**A consistent fire history across changing satellites.** FIREBRIDGE turns NASA
FIRMS active-fire records from MODIS (Terra, Aqua) and VIIRS (Suomi-NPP, NOAA-20,
NOAA-21) into an explorable, reproducible calendar of burning activity for any
area, while keeping every sensor difference visible. Built for the NASA Space
Apps Challenge 2026, challenge "Harmonization of MODIS and VIIRS Hot Spots".

- Live application: https://astramind.solutions
- How the data is processed: https://astramind.solutions/evidence
- Sources, licences and AI use: https://astramind.solutions/sources

| Repository | Contents |
|---|---|
| This repository | Web application, API, workers and the in-browser harmonization engine |
| [FireBridge-data-pipeline](https://github.com/Nasa-hackathon-FIREBRIDGE/FireBridge-data-pipeline) | NASA FIRMS download, audit, indexing and publication |
| [FireBridge-AI-Agent](https://github.com/Nasa-hackathon-FIREBRIDGE/FireBridge-AI-Agent) | Explanation service behind the copilot |

All three are released under the [MIT licence](LICENSE).

## Layout

This is the team's integration branch, connected to the data pipeline.

```text
firebridge-backend/    Fastify API, worker, shared contracts and database
firebridge-frontend/   React application and HTTP integration
```

Both applications are included in a single clone of the `staging` branch.
Work reports remain available on the development branches. Automated tests and
CI stay in the repository for maintenance; test files and project Markdown are
excluded from the Docker build contexts.

## Docker build

From `firebridge-backend`, create a private `.env` file from `.env.example`,
then fill in the deployment secrets and URLs:

```bash
docker compose config --quiet
docker compose build api worker frontend
```

The provided Compose file describes the development environment. Starting on
the VPS must use the configuration and networks planned for the existing database.

## Connecting to the real data

- Reference: `docs/data/NODE_HANDOFF.md` in the
  [FireBridge-data-pipeline](https://github.com/Nasa-hackathon-FIREBRIDGE/FireBridge-data-pipeline) repository.
- Check that the pipeline's `serving` views match the backend repositories, as
  well as the application's read and write permissions.
- Coordinate migrations with the data lead before applying anything to their
  database. The pipeline's read-only account is not enough to write the
  application's areas, analyses and jobs.
- Configure `DOCKER_DATABASE_URL`, `DOCKER_REDIS_URL`, `DEFAULT_SCOPE_KEY`,
  `FRONTEND_API_URL` and `CORS_ORIGINS` for the server. Secrets stay in private
  `.env` files; frontend URLs are public and fixed at build time.
- For production, use `deploy/compose.production.yaml` and the private variables
  in `/opt/firebridge/webapp/runtime.env`; see [deploy/README.md](deploy/README.md).
  The development Compose file must not replace the existing data stack.

The API, worker and frontend images have been built in this structure.
Dependencies were updated before public exposure: the production npm audits of
the backend and frontend reported no vulnerabilities on 8 November 2026. Six
moderate alerts remain in backend development tools; CI accepts no high or
critical alert.

## Production (Contabo)

- Site: https://astramind.solutions; API: `/api/v1`.
- The `staging` branch is deployed after validation by `.github/workflows/webapp.yml`.
- Configuration, private network, restricted SQL account and CI/CD operation:
  [deploy/README.md](deploy/README.md).
- Images are built and tested in CI, then transferred by a dedicated SSH account.
  No server secret is part of the images or the repository.
- The database and the existing pipelines stay in their own stack.
