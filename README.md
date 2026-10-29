# FIREBRIDGE

FIREBRIDGE est le backend du projet NASA Space Apps Challenge « Harmonization of MODIS and VIIRS Hot Spots ». Il utilise TypeScript, Fastify et PostgreSQL/PostGIS, avec un worker séparé pour les traitements longs.

Pour comprendre la vision du produit, le travail publié par l’équipe et la suite du développement, lire [Comprendre FIREBRIDGE](docs/COMPRENDRE_FIREBRIDGE.md). Ce document distingue l’état GitHub des modifications encore locales.

La phase 1 implémente trois routes en lecture seule : `GET /api/v1/catalog`, `GET /api/v1/releases/{release_id}` et `GET /api/v1/updates`. Les autres ressources sont encore des squelettes et renvoient `501`.

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
docker compose up -d postgres
npm run dev:api
```

Sous PowerShell, utiliser `npm.cmd` si l’exécution des scripts `npm.ps1` est bloquée.

Docker démarre PostgreSQL/PostGIS ; il n’applique pas les migrations métier. Les migrations de l’équipe ne sont pas encore présentes dans le dépôt. En attendant leur livraison, le schéma SQL fourni peut servir à initialiser une base de développement vide, explicitement :

```bash
docker compose cp packages/database/prisma/sql/firebridge_schema_v2.sql postgres:/tmp/firebridge_schema_v2.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U firebridge -d firebridge -f /tmp/firebridge_schema_v2.sql
```

Ce SQL est un artefact de conception pour une base vide, pas un historique de migrations. Les évolutions d’une base déjà initialisée devront suivre les migrations livrées par l’équipe ; le squelette `prisma migrate` actuel ne crée pas les tables métier de cette phase. L’API ne lance aucune migration au démarrage.

L’API écoute sur `http://localhost:3000`. Swagger est accessible sur `http://localhost:3000/api-docs` et son document JSON sur `/api-docs/json`.

**Aucune donnée NASA ni release n’est inventée au démarrage.** Tant que l’ingestion n’a pas publié de release et d’alias pour le scope choisi, `/catalog` sans paramètres et `/health/ready` répondent `503`. `/health/live` reste disponible. Un scope explicitement inconnu répond `404`.

Redis est nécessaire au futur traitement asynchrone, mais pas aux trois lectures de la phase 1. Pour démarrer le worker existant : `docker compose up -d redis`, puis `npm run dev:worker`.

## Validation

Pour tester manuellement les trois endpoints, démarrer l’API avec une base initialisée et une release publiée, puis ouvrir `http://localhost:3000/api-docs/`. Le [contrat HTTP](API.md) décrit les paramètres et les réponses à vérifier. Les fixtures fictives versionnées servent aux tests automatisés ci-dessous ; aucun serveur de démo n’est livré dans le dépôt.

```bash
npm run lint
npm run build
npm test
```

Les tests des routes exécutent les requêtes SQL dans PostgreSQL embarqué via PGlite avec des données fictives isolées. Ils utilisent les définitions des tables du schéma SQL ; les types PostGIS y sont remplacés uniquement pour ces tests de métadonnées. Ils ne valident pas l’installation de PostGIS ni les requêtes spatiales. Aucun accès NASA, Redis ou Docker n’est requis pour ces tests.

Le workflow GitHub Actions exécute ces trois vérifications sur les Pull Requests et les branches `main`, `staging` et `feat/**`.
