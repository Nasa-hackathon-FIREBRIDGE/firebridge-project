# FIREBRIDGE

FIREBRIDGE est le backend du projet NASA Space Apps Challenge « Harmonization of MODIS and VIIRS Hot Spots ». Il utilise TypeScript, Fastify et PostgreSQL/PostGIS, avec un worker séparé pour les traitements longs.

La phase 1 implémente trois routes en lecture seule : `GET /api/v1/catalog`, `GET /api/v1/releases/{release_id}` et `GET /api/v1/updates`. Les routes `GET /api/v1/sources` et `POST /api/v1/sources` sont également implémentées. Les autres ressources restent des squelettes `501`.

Le [guide de la phase 1](docs/PHASE_1.md) explique le fonctionnement, les limites et le contrat à partager avec la personne chargée de l’ingestion. Le [contrat HTTP](API.md) décrit les paramètres et les réponses. Les documents de conception fournis par l’équipe restent dans `documents/`.

## Architecture overview

- `apps/api`: HTTP API layer, routing, request validation, controllers, middleware, and API documentation
- `apps/worker`: asynchronous processing and queue workers using BullMQ and Redis
- `packages/domain`: business entities and domain rules
- `packages/contracts`: shared interfaces and DTOs
- `packages/database`: schéma SQL PostgreSQL/PostGIS et squelette Prisma. La phase 1 utilise des requêtes SQL paramétrées avec `pg`, car le modèle Prisma ne décrit pas encore les tables métier.
- `packages/integrations`: external provider adapters for satellite, weather, storage, and AI integrations
- `packages/observability`: logging and tracing helpers

## Local development

Prérequis : Node.js 22 ou supérieur, npm et Docker Desktop démarré pour PostgreSQL/PostGIS.

1. Copier `.env.example` vers `.env` si ce fichier n’existe pas déjà.
2. Remplacer `CURSOR_SECRET` par une valeur aléatoire d’au moins 32 caractères. Tous les processus API doivent partager la même valeur. Une rotation invalide les anciens curseurs.
3. Installer et démarrer :

```bash
npm ci
docker compose up -d postgres redis
npm run dev:api
```

Sous PowerShell, utiliser `npm.cmd` si l’exécution des scripts `npm.ps1` est bloquée.

Les migrations de `main` sont reprises dans `packages/database/prisma/migrations/`. Sur une base de développement configurée, appliquer les migrations existantes avec :

```bash
npm run prisma:deploy --workspace @firebridge/database
```

Ces migrations créent actuellement `public.HealthCheck` et `firebridge.sources`. Elles ne créent pas encore les tables de releases, partitions et inventaires nécessaires à la phase 1. Le fichier `firebridge_schema_v2.sql` reste un artefact de conception : ne pas l’exécuter par-dessus les migrations pour compléter la base. Les tables manquantes doivent faire l’objet de migrations additives et d’une validation avec l’équipe.

Le client Prisma et le package database sont générés avant le démarrage, la compilation et les tests de l’API. Aucune migration n’est lancée automatiquement par le serveur.

L’API écoute sur `http://localhost:3000`. Swagger est accessible sur `http://localhost:3000/api-docs` et son document JSON sur `/api-docs/json`.

**Aucune donnée NASA ni release n’est inventée au démarrage.** Tant que l’ingestion n’a pas publié de release et d’alias pour le scope choisi, `/catalog` sans paramètres et `/health/ready` répondent `503`. `/health/live` reste disponible. Un scope explicitement inconnu répond `404`.

La readiness vérifie PostgreSQL, Redis et la disponibilité du catalogue, avec un délai borné. Les lectures du catalogue ne contactent pas Redis, mais l’API reste déclarée non prête si une dépendance requise échoue. Les endpoints de santé canoniques sont `/api/v1/health/live` et `/api/v1/health/ready`.

`CORS_ORIGINS` permet une liste d’origines navigateur autorisées, séparées par des virgules. En développement, la liste vide reste permissive. En production, configurer cette liste et remplacer les secrets de pagination.

Le worker peut être lancé avec `npm run dev:worker`, mais n’a pas encore de processeur de jobs enregistré : son statut est `not_configured`.

## Validation

Pour tester manuellement les trois endpoints, démarrer l’API avec une base initialisée et une release publiée, puis ouvrir `http://localhost:3000/api-docs/`. Le [contrat HTTP](API.md) décrit les paramètres et les réponses à vérifier. Les fixtures fictives versionnées servent aux tests automatisés ci-dessous ; aucun serveur de démo n’est livré dans le dépôt.

```bash
npm run lint
npm run build
npm test
```

Les tests des routes exécutent les requêtes SQL dans PostgreSQL embarqué via PGlite avec des données fictives isolées. Ils utilisent les définitions des tables du schéma SQL ; les types PostGIS y sont remplacés uniquement pour ces tests de métadonnées. Ils ne valident pas l’installation de PostGIS ni les requêtes spatiales. Aucun accès NASA, Redis ou Docker n’est requis pour ces tests.

Le workflow GitHub Actions exécute ces trois vérifications sur les Pull Requests et les branches `main`, `staging` et `feat/**`.
