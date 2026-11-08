# FIREBRIDGE frontend

Application React/TypeScript, construite avec Vite et servie par Nginx dans Docker.

- `src/pages` et `src/features` : écrans et fonctionnalités.
- `src/hooks` : accès aux données avec TanStack Query.
- `src/services` : appels HTTP Axios vers l'API Fastify.
- `src/components` : composants partagés et carte MapLibre.

Le package `@firebridge/contracts` est fourni par
`../firebridge-backend/packages/contracts`. Conserver ces noms de dossiers.
Voir le [README principal](../README.md) pour la construction Docker et la
configuration de l'API. Les `.env` privés ne sont pas inclus dans le dépôt.
