# FIREBRIDGE frontend

React/TypeScript application, built with Vite and served by Nginx in Docker.

- `src/pages` and `src/features`: screens and features.
- `src/hooks`: data access with TanStack Query.
- `src/services`: Axios HTTP calls to the Fastify API.
- `src/components`: shared components and the MapLibre map.

The `@firebridge/contracts` package comes from
`../firebridge-backend/packages/contracts`. Keep these folder names.
See the [main README](../README.md) for the Docker build and API configuration.
Private `.env` files are not included in the repository.
