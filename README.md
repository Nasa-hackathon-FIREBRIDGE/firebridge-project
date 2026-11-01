# FIREBRIDGE

FIREBRIDGE est le backend du projet NASA Space Apps Challenge « Harmonization of MODIS and VIIRS Hot Spots ». Il utilise TypeScript, Fastify et PostgreSQL/PostGIS, avec un worker séparé pour les traitements longs.

La phase 1 implémente le catalogue et les versions. La phase 2 apporte les zones, les analyses et les jobs. La phase 3 lit les détections, le résumé, le calendrier natif et la provenance sous `/api/v1/analyses/{id}`. Les routes Sources sont également implémentées ; les autres ressources restent des squelettes `501`.

Les guides de [phase 1](docs/PHASE_1.md) et de [phase 3](docs/PHASE_3.md) décrivent les contrats d’intégration, les limites et la compatibilité des migrations. Le [contrat HTTP](API.md) décrit les paramètres et les réponses. Les documents de conception fournis par l’équipe restent dans `documents/`.

## Architecture overview

- `apps/api`: HTTP API layer, routing, request validation, controllers, middleware, and API documentation
- `apps/worker`: asynchronous processing and queue workers using BullMQ and Redis
- `packages/domain`: business entities and domain rules
- `packages/contracts`: shared interfaces and DTOs
- `packages/database`: migrations PostgreSQL/PostGIS et modèles Prisma des tables migrées. La phase 1 utilise des requêtes SQL paramétrées avec `pg` ; les Sources utilisent Prisma.
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
npm run prisma:deploy --workspace @firebridge/database
npm run dev:api
```

Sous PowerShell, utiliser `npm.cmd` si l’exécution des scripts `npm.ps1` est bloquée.

Les migrations de `main` sont reprises dans `packages/database/prisma/migrations/`. Sur une base de développement configurée, appliquer les migrations existantes avec :

```bash
npm run prisma:deploy --workspace @firebridge/database
```

Les trois premières migrations créent `public.HealthCheck`, `firebridge.sources`, puis les 15 tables nécessaires au catalogue et aux versions : assets, releases, membres, runs, zones, grilles, métriques, feeds, disponibilités, abonnements et partitions. La nouvelle migration active PostGIS, préserve les tables existantes et n’insère aucune donnée. Le fichier `firebridge_schema_v2.sql` reste un artefact de conception : ne pas l’exécuter par-dessus les migrations.

La quatrième migration, `20261101000000_phase2_native_serving`, réconcilie le schéma complet de la branche phase 2 en ajoutant seulement les 31 tables restantes. Les trois premières migrations et les données existantes sont conservées. Une base créée avec l’ancienne migration consolidée de la branche phase 2 doit être reprise séparément : voir le [guide phase 3](docs/PHASE_3.md).

Le modèle Prisma conserve aussi la table historique `HealthCheck` et une correspondance ignorée par le client pour `spatial_ref_sys`, qui appartient à PostGIS. Les champs spatiaux sont `Unsupported("geometry")` ; les contraintes `CHECK`, les types spatiaux précis et les index partiels restent définis dans les migrations SQL. Toute nouvelle migration doit préserver ces éléments.

Si le port Redis `6379` est occupé, choisir par exemple `REDIS_PORT=16379` et `REDIS_URL=redis://localhost:16379` dans `.env`, puis relancer les services. Les conteneurs continuent d’utiliser leur port interne `6379`.

Le client Prisma et le package database sont générés avant le démarrage, la compilation et les tests de l’API. Aucune migration n’est lancée automatiquement par le serveur.

L’API écoute sur `http://localhost:3000`. Swagger est accessible sur `http://localhost:3000/api-docs` et son document JSON sur `/api-docs/json`.

**Aucune donnée NASA ni release n’est inventée au démarrage.** Tant que l’ingestion n’a pas publié de release et d’alias pour le scope choisi, `/catalog` sans paramètres et `/health/ready` répondent `503`. `/health/live` reste disponible. Un scope explicitement inconnu répond `404`.

La readiness vérifie PostgreSQL, Redis et la disponibilité du catalogue, avec un délai borné. Les lectures du catalogue ne contactent pas Redis, mais l’API reste déclarée non prête si une dépendance requise échoue. Les endpoints de santé canoniques sont `/api/v1/health/live` et `/api/v1/health/ready`.

`CORS_ORIGINS` permet une liste d’origines navigateur autorisées, séparées par des virgules. En développement, la liste vide reste permissive. En production, configurer cette liste et remplacer les secrets de pagination.

Le worker peut être lancé avec `npm run dev:worker`. La phase 2 apporte un dispatcher d’outbox et le processeur `analysis.requested`, qui gère actuellement le cycle de vie et les composants. Les comptages natifs de phase 3 sont des lectures SQL bornées ; le worker ne réalise pas encore d’ingestion NASA ni d’harmonisation.

## Validation

Pour tester manuellement les trois endpoints, démarrer l’API avec une base initialisée et une release publiée, puis ouvrir `http://localhost:3000/api-docs/`. Le [contrat HTTP](API.md) décrit les paramètres et les réponses à vérifier. Les fixtures fictives versionnées servent aux tests automatisés ci-dessous ; aucun serveur de démo n’est livré dans le dépôt.

```bash
npm run lint
npm run build
npm test
```

Les tests des routes exécutent les requêtes SQL dans PostgreSQL embarqué via PGlite avec des données fictives isolées. Ils appliquent la chaîne réelle des migrations, avec une adaptation des types et fonctions PostGIS pour ces tests de métadonnées. Aucun accès NASA, Redis ou Docker n’est requis pour `npm test`.

Une suite séparée vérifie les migrations et les endpoints sur PostgreSQL/PostGIS et Redis réels. Elle charge des données fictives uniquement dans la base nommée `firebridge_phase1_test`, avec des scopes et des identifiants synthétiques. Le jeu courant des phases 1/3 utilise `phase1_test` et des releases préfixées `TEST ONLY`. Elle conserve ce jeu après les tests pour permettre une vérification manuelle. **Elle refuse toute autre base.** Créer cette base une seule fois :

```bash
docker compose exec postgres createdb -U firebridge firebridge_phase1_test
```

Puis, dans PowerShell, adapter le port Redis à celui de `.env` :

```powershell
$env:PHASE1_TEST_DATABASE_URL='postgresql://firebridge:firebridge@localhost:5432/firebridge_phase1_test'
$env:PHASE1_TEST_REDIS_URL='redis://localhost:16379'
$env:DATABASE_URL=$env:PHASE1_TEST_DATABASE_URL
npm.cmd run prisma:deploy --workspace @firebridge/database
Remove-Item Env:DATABASE_URL
npm.cmd run test:postgres --workspace @firebridge/api
npm.cmd run test:postgres --workspace @firebridge/worker
```

Pour préparer les données synthétiques de la phase 3 après les tests :

```powershell
npm.cmd run fixtures:phase3 --workspace @firebridge/api
```

La commande est limitée à `firebridge_phase1_test` et affiche l’identifiant de l’analyse à utiliser. Elle remplace les fixtures de cette base dédiée, sans toucher à la base principale. Elle ne démarre aucun serveur de démonstration.

Pour consulter ce jeu avec Swagger sur un port distinct :

```powershell
$env:DATABASE_URL=$env:PHASE1_TEST_DATABASE_URL
$env:REDIS_URL=$env:PHASE1_TEST_REDIS_URL
$env:DEFAULT_SCOPE_KEY='phase1_test'
$env:PORT='3002'
npm.cmd run dev:api
```

Ouvrir `http://localhost:3002/api-docs/`. Ces réponses utilisent une vraie base PostgreSQL, mais leurs données restent fictives. Fermer ce terminal après les essais pour retrouver les paramètres habituels de `.env` dans une nouvelle session.

Le workflow GitHub Actions exécute lint, build et tests rapides, ainsi qu’un job PostgreSQL/PostGIS et Redis dédié, sur les Pull Requests et les branches `main`, `staging` et `feat/**`.
