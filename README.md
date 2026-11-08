# FIREBRIDGE backend

API Fastify en TypeScript et worker BullMQ. PostgreSQL/PostGIS conserve les
données ; Redis porte les files de tâches.

- `apps/api/src` : routes, controllers, services et repositories.
- `apps/worker/src` : dispatcher et traitements asynchrones.
- `packages/contracts` : contrats partagés avec le frontend.
- `packages/database` : accès aux données et migrations applicatives.
- `docker-compose.yml` : définition des services locaux.

Voir le [README principal](../README.md) pour la construction Docker et le
raccordement au pipeline. La documentation HTTP est générée par l'API sous
`/api-docs/`. Les `.env` privés ne sont pas inclus dans le dépôt.
