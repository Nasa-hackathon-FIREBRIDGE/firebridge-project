# FIREBRIDGE — rapport Phase 4

> Historical report from the Phase 4 branch. For the merged implementation, current fixture v2, actual identity behavior and fresh validation, see [integration report](docs/PHASE_4_REVIEW.md).

> Historique de l’implémentation initiale. La validation réelle ultérieure et
> l’état actuel sont dans [docs/API_AUDIT.md](docs/API_AUDIT.md) et
> [docs/API_TEST_REPORT.md](docs/API_TEST_REPORT.md). Les mentions « non exécuté »
> ci-dessous décrivent uniquement cette préparation initiale.

Pour préparer des données cohérentes sans les insérer automatiquement, voir
[le guide de fixture Phase 4](PHASE4_FIXTURE.md) : aperçu déterministe, garde
des bases de test, commandes curl et vérification des fichiers téléchargés.

Implémentation du 31 octobre 2026. Les trois routes sont présentes dans Fastify.
La validation PostgreSQL/PostGIS réelle reste à effectuer sur une infrastructure
de test isolée. Aucun commit, push, reset, changement de secret ni déploiement
de migration n'a été effectué.

## 1. Audit préalable

L'arborescence des applications, packages, configurations et tests a été examinée
avant les modifications. Le code exécuté utilise Fastify 5, malgré des mentions
historiques d'Express dans la documentation.

- Les modules Sources, Areas, Analyses et Jobs fournissent les conventions
  existantes : contrôleurs Fastify, services, repositories, Zod et enveloppes JSON
  `status/message/data`. Les erreurs passent par `AppError` et le gestionnaire
  central qui masque les messages internes.
- Les routes Tiles/Exports étaient des squelettes 501. Les routes existantes
  `/tiles` et `/exports` conservent leur comportement ; la Phase 4 ajoute les
  routes imbriquées demandées.
- Le schéma Prisma et la migration v2 définissent `analyses`,
  `analysis_components`, `areas`, `detections`, `data_partitions`,
  `partition_detections`, `release_partitions`, `api_jobs` et `outbox_events`.
  Une détection ne porte pas directement `analysis_id`.
- La sélection correcte traverse les partitions de la release satellite figée,
  puis intersecte la zone et la période de l'analyse. Un `EXISTS` prévient les
  doublons entre partitions. Les détections `nrt/rt/urt` ne sont pas mélangées aux
  détections `standard`.
- Les index GiST de `detections.geom`, les clés de partitions et l'index inverse
  `partition_detections_reverse` existent dans les fichiers versionnés.
- Les jobs possèdent déjà lease, tentative, URI de résultat, SHA-256, taille et
  expiration. Aucune nouvelle table ou colonne n'est nécessaire.
- Le dispatcher utilise déjà `FOR UPDATE SKIP LOCKED`, leases et déduplication
  BullMQ. Le worker traitait seulement `analysis.requested`.
- Redis et un middleware d'idempotence existent. Aucun authentificateur effectif,
  contrôle d'accès aux résultats, stockage de fichiers ni limiteur de requêtes
  Phase 4 n'était installé.
- Les anciens tests d'intégration pouvaient hériter du `.env` de développement.
  Leur configuration est désormais isolée et explicite.

L'audit des tables/index **de la base active** a été tenté en lecture seule,
dans puis hors sandbox : `PrismaClientInitializationError` dans les deux cas.
Les constats de schéma ci-dessus portent donc sur les fichiers versionnés,
pas sur une vérification réussie de l'instance PostgreSQL.

## 2. Fichiers créés et modifiés

Créés :

- `packages/results/{package.json,tsconfig.json,src/config.ts,src/contracts.ts,src/detections.repository.ts,src/index.ts,src/storage.ts}` : contrats communs, configuration, sélection spatiale et abstraction de stockage.
- `apps/api/src/controllers/results.controller.ts`.
- `apps/api/src/middleware/results-access.ts`.
- `apps/api/src/repositories/{exports,tiles}.repository.ts`.
- `apps/api/src/services/{exports.service,tile-layers,tiles.service}.ts`.
- `apps/api/src/validators/results.validator.ts`.
- `apps/worker/src/exports/{csv,geojson,parquet,write-export}.ts`.
- `apps/worker/src/processors/export.processor.ts`.
- `apps/worker/src/repositories/exports.repository.ts`.
- `apps/worker/src/services/export-cleanup.ts`.
- `apps/worker/src/types/parquetjs-lite.d.ts`.
- `packages/database/prisma/migrations/20261031000000_phase4_serving_indexes/migration.sql`.
- `apps/api/tests/{exports.repository,results.routes,tiles.query}.test.ts`.
- `apps/worker/tests/{export-cleanup,export-formats,export-storage,export.processor.unit,phase4.integration}.test.ts`.
- `apps/worker/vitest.config.ts`, `tests/infrastructure.ts`, `scripts/run-integration.mjs`, `PHASE4.md`.

Modifiés :

- `apps/api/src/app.ts`, `apps/api/src/routes/{analyses,jobs}.routes.ts`,
  `apps/api/src/controllers/jobs.controller.ts`, `apps/api/src/services/jobs.service.ts`.
- `apps/worker/src/worker.ts`, `apps/worker/src/queues/firebridge-queue.ts`,
  `apps/worker/src/services/outbox-dispatcher.ts`,
  `apps/worker/src/shutdown/shutdown-manager.ts`.
- `apps/api/vitest.config.ts`, les `package.json` racine/API/worker,
  `package-lock.json`, `eslint.config.js`, `docker-compose.yml`, `.dockerignore`,
  `.gitignore`, `.env.example`, `API.md`, `README.md`, `endpoint_catalog.json`.

Le lockfile a aussi été synchronisé avec les manifestes existants, qui avaient
déjà retiré Express ; npm a retiré leurs anciennes entrées inutilisées du lock.
Les sauvegardes SQL/Prisma et migrations de sauvegarde présentes au départ
n'ont pas été modifiées. Le véritable `.env` n'a pas été modifié.

## 3. Contrats HTTP réellement implémentés

### Tuile

`GET /api/v1/analyses/:id/tiles/:layer/:z/:x/:y.mvt`

UUID et entiers décimaux canoniques validés par Zod ; seule `detections` est
acceptée. Zoom 0–18 par défaut, plafond configurable jusqu'à 22 ;
`0 <= x,y < 2^z`. Vérification de l'identité et de l'accès avant le cache.

PostGIS limite la sélection par `ST_TileEnvelope`, `&&` et `ST_Intersects`.
Les points sont projetés en 3857, regroupés sur une grille mondiale au pas de
1/64 de tuile, puis encodés par `ST_AsMVTGeom` et `ST_AsMVT`. Cette agrégation
conserve tous les effectifs sans `LIMIT` arbitraire, et produit au plus environ
65 × 65 positions par tuile. Les propriétés sont `count` et `frp_mw` maximal.
Une simplification de lignes/polygones n'a pas de sens pour ces points ; la
quantification s'adapte au zoom. Les latitudes hors Web Mercator sont exclues
des tuiles, mais restent disponibles dans les exports WGS84.

Réponse 200 binaire `application/vnd.mapbox-vector-tile`, y compris une tuile
vide de zéro octet. HTTP : `Cache-Control: private, no-store`.
Redis conserve les octets pendant 60 secondes par défaut.

### Demande d'export

`POST /api/v1/analyses/:id/exports`

Header obligatoire `Idempotency-Key` et corps strict, limité à 8 Kio :

```json
{
  "format": "csv",
  "filters": { "source_id": "source-id", "day_night": "day" },
  "options": {}
}
```

`format` : `csv`, `geojson` ou `parquet`. Les deux filtres sont optionnels ;
`day_night` accepte `day/night/unknown`. `filters` et `options` peuvent être
omis. Toute propriété inconnue est refusée. Aucune option SQL, chemin, colonne
ou fournisseur de stockage fourni par le client n'est accepté.

La transaction PostgreSQL prend un verrou par utilisateur, vérifie à nouveau
l'analyse, récupère un éventuel job idempotent, vérifie les quotas puis crée
`api_jobs` et `export.requested` dans `outbox_events` ensemble. La clé durable
est distincte de celle des analyses et reste effective après perte du replay
Redis. La même clé avec un payload différent renvoie 409.

Réponse 202 dans l'enveloppe existante :

```json
{
  "status": "ok",
  "message": "Export queued.",
  "data": {
    "job_id": "UUID",
    "analysis_id": "UUID",
    "status": "queued",
    "format": "csv",
    "created_at": "ISO-8601",
    "status_url": "/api/v1/jobs/UUID"
  }
}
```

`Location` pointe vers le suivi existant. Un replay durable peut retourner
l'état actuel du même job avec le même statut HTTP 202. Aucun fichier ni
comptage massif des détections n'est généré dans le processus HTTP.

### Téléchargement

`GET /api/v1/jobs/:id/download`

Job export appartenant à l'utilisateur et analyse toujours accessible ; succès
obligatoire, expiration, référence, format et taille contrôlés. Le fichier est
ouvert puis vérifié par descripteur avant streaming. Le nom public est
`firebridge-<job_id>.<format>`.

- 200 : flux avec MIME, `Content-Disposition` et taille disponible ; les
  middleware de compression peuvent adapter les en-têtes si le client demande
  un encodage compressé.
- 409 : job en attente, en cours, échoué ou annulé.
- 404 : job inexistant, autre type ou non accessible ; même politique pour les
  analyses inaccessibles.
- 410 : fichier expiré, supprimé ou absent.
- 401 : identité serveur absente ; 400 : entrée invalide ; 429 : limite atteinte.
- 500 : erreur interne masquée ; 503 : limiteur Redis indisponible.

Les réponses binaires échappent à l'enveloppe JSON. Les erreurs conservent le
contrat JSON existant. Aucune URL signée n'est utilisée : le stockage est local.

## 4. Base de données

Une migration additive proposée crée quatre index partiels sur `api_jobs` :

| Index | Usage |
| --- | --- |
| `jobs_analysis_requester` | preuve d'accès via le job d'analyse initial |
| `jobs_export_active` | quota des jobs actifs |
| `jobs_export_recent` | quota horaire |
| `jobs_export_expiry` | nettoyage par expiration |

Ces index sont absents du schéma/migration versionnés examinés. Leur absence ou
l'absence d'équivalent sur l'instance active n'a pas pu être vérifiée. Les noms
sont protégés par `IF NOT EXISTS`. La migration n'a pas été appliquée ; vérifier
les index existants et le temps de verrouillage avant son déploiement. Les
index partiels sont définis en SQL, car Prisma 6 ne les exprime pas dans ce
modèle. Aucune table, colonne ou migration existante n'a été supprimée.

## 5. Worker et outbox

Le dispatcher existant route `export.requested` vers `firebridge-exports`,
avec trois tentatives et backoff exponentiel. Le worker d'analyse conserve sa
file et sa concurrence existantes. Le worker export a une concurrence de deux
par processus, configurable séparément. L'arrêt attend workers, queues et
nettoyage avant la déconnexion de PostgreSQL.

Le payload de queue ne contient que `job_id` ; la requête réelle est relue de la
base. La prise de lease SQL est atomique. Le numéro de tentative protège la
publication contre un ancien worker ; une livraison concurrente encore sous
lease est différée. Un job réussi n'est pas régénéré. Les leases expirées sont
reprises avec un nouvel événement outbox, sans transaction partielle. Les
échecs terminaux BullMQ finalisent aussi l'état SQL.

Lecture keyset par identifiant croissant, lots de 1 000 et snapshot
`REPEATABLE READ` borné en durée. CSV et GeoJSON utilisent des générateurs et
streams ; Parquet écrit par groupes de 2 048 lignes, avec métadonnées de groupes
nécessaires au format. Les données complètes ne sont jamais assemblées en RAM.
Les textes dépassant 1 024 caractères utiles sont refusés, au lieu de produire
un export tronqué. Les identifiants bigint restent des chaînes exactes.

`parquetjs-lite@0.8.7` ajoute cinq petits packages JavaScript, sans moteur natif
ou fournisseur externe. Son API publique d'enveloppe est utilisée pour attendre
l'en-tête et gérer correctement une erreur disque précoce.

Les fichiers temporaires exclusifs sont publiés par renommage, puis référencés
avec SHA-256, taille et expiration. Un accusé SQL perdu après commit ne provoque
pas la suppression du fichier publié. Les tentatives abandonnées sont reprises
par le nettoyage. Les enregistrements jobs/outbox sont conservés.

## 6. Sécurité et prérequis d'exploitation

**Authentification à brancher avant utilisation réelle.** Le dépôt ne fournit
aucun vérificateur de jeton/session. `createApp({ authenticate })` accepte un hook
serveur qui vérifie réellement la session puis remplit `request.user.id` avec
un identifiant de principal globalement unique, y compris entre tenants.
Le `server.ts` standard ne configure pas ce hook : sans intégration, les routes
Phase 4 refusent l'accès. Aucun header d'identité client n'est considéré comme
preuve d'authentification. Les tests injectent uniquement une identité fictive.

L'accès à une analyse exige un job `kind=analysis` dont `requested_by` correspond
à cette identité. Les analyses anonymes historiques ne sont pas revendicables.
Une analyse partagée par cache global avec un autre utilisateur ne lui accorde
pas implicitement l'accès ; un futur mécanisme de partage devra être explicite.
Le suivi d'un job export est également protégé, sans changer sa réponse JSON.

Sélection Phase 4 actuellement supportée : `native_detections_v1`, UTC,
`selection_policy=standard`, `grid_id=null`, analyse `ready/partial`, composant
satellite `ready` et release `published`. Les autres sémantiques temporelles ou
de sélection renvoient 409, faute de traitement existant vérifié.

SQL paramétré exclusivement, registry de couches contrôlée par le code,
autorisation avant replay/cache, clés Redis isolées par utilisateur, aucun
cache HTTP public. Les logs Phase 4 contiennent identifiants techniques,
formats, tailles et états, sans token, chemin interne ni données de détection.

Les cellules CSV textuelles dangereuses sont préfixées d'une apostrophe,
y compris après espaces/contrôles ; guillemets et retours à la ligne sont
échappés. Les valeurs numériques négatives restent des nombres utilisables.

Clés de fichiers UUID générées par le serveur, regex fermée, stockage hors
répertoire public, création exclusive, modes 0700/0600 lorsque le système les
applique, vérification `lstat`, non-suivi des symlinks si disponible et contrôle
du descripteur. Aucun chemin client ni lien permanent n'est exposé.

Par défaut : 120 tuiles/minute, 5 demandes d'export/minute, 30 téléchargements/
minute/utilisateur ; deux exports actifs et dix créations/heure/utilisateur ;
un million de lignes, 256 Mio et 300 secondes/export ; conservation 24 h.
Les plafonds sont contrôlés pendant l'exécution : un volume excessif fait
échouer le job sans publier de fichier partiel. Le limiteur Redis échoue fermé.
Toutes les valeurs sont validées dans `packages/results/src/config.ts` et
documentées dans `.env.example`.

API et workers doivent partager `EXPORT_STORAGE_DIR`. Compose fournit le volume
`exports_data`. Sur plusieurs hôtes, un volume partagé compatible ou un adapter
implémentant `ExportStorage` est requis. Le compte système doit être le seul à
écrire dans ce répertoire. Prévoir l'espace disque selon les quotas, le nombre
d'utilisateurs et la rétention. Le nettoyage automatique agit uniquement sur
les artefacts d'export gérés et expirés, pas sur les données métier.

## 7. Performance et invalidation

Les requêtes de tuile sont bornées spatialement et en durée (5 s par défaut),
avec `work_mem` local de 8 Mio et un plafond de réponse de 2 Mio. L'agrégation
évite une réponse proportionnelle au nombre de détections ; aucune détection
n'est chargée dans la mémoire de l'API. Les exports ont une taille de lot,
une durée, un volume, une taille de fichier et une concurrence bornés.

La clé Redis de tuile inclut version du code, utilisateur haché, analyse,
`cache_key`, release satellite, date de complétion, état, couche et XYZ. Tout
changement de release/complétion rend l'ancienne entrée inutilisable. Le modèle
décrit les releases et partitions comme des snapshots immuables. Une révision
doit créer une nouvelle release/analyse ou changer la date de complétion ; en
cas de correction opérationnelle en place, purger le namespace concerné ou
attendre le TTL de 60 s. L'accès est revérifié même sur un cache hit.

Les mesures réelles PostGIS et concurrence DB sont préparées dans
`apps/worker/tests/phase4.integration.test.ts` : 10 000 détections et contre-
exemples de zone/date/stream/release, exports des trois formats, doublons,
requêtes concurrentes, santé HTTP et `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.
Le plan, les index et cinq temps de tuile sont écrits dans le sous-dossier
`metrics` du stockage temporaire de test. Le choix effectif de GiST est rapporté,
sans forcer le planificateur ni prétendre qu'un petit jeu exige cet index.

## 8. Vérifications exécutées

Résultats du passage final de `npm.cmd test` (code 0) :

| Contrôle | Résultat exécuté |
| --- | --- |
| `npm.cmd run build` | succès, génération Prisma et compilation API/worker/packages requis |
| `npm.cmd run typecheck` | succès, zéro erreur |
| `npm.cmd run lint` | succès, zéro erreur |
| API | **198 tests réussis, 15 fichiers**, 7,54 s |
| Worker | **41 tests réussis, 4 fichiers**, 2,36 s ; aucun rejet non géré |
| `git diff --check` | succès |

Le writer CSV de 50 000 lignes avec destination ralentie a pris **591 ms**
dans ce passage : avance maximale **11 lignes**, variation RSS mesurée
**15 155 200 octets** (environ 14,45 Mio). Il s'agit d'une mesure du writer dans
un processus Vitest, sans PostgreSQL ; ce n'est pas une garantie de mémoire
totale en production. Les essais précédents variaient selon l'état du runtime.
Le passage worker supplémentaire après le contrôle final de durée réussit
également : 41/41 tests, 2,22 s ; writer CSV 542 ms, delta RSS 13 819 904 octets,
avance maximale inchangée de 11 lignes. Ces essais ont utilisé Node 24.22.1 ;
l'image Docker Node 22 n'a pas été exécutée ici.
Le passage API supplémentaire après le hachage des scopes d'idempotence réussit
également : 198/198 tests, 15 fichiers, 6,84 s. Build, typecheck et lint ont
ensuite été relancés avec succès sur le code final.
Parquet a été relu avec succès sur un fichier de 2 200 lignes, traversant
plusieurs groupes. Les tests de stockage utilisent de vrais fichiers temporaires.

Les tests d'intégration réels ne sont pas présentés comme réussis.

`npm.cmd run test:integration` a été lancé et s'est arrêté avant les tests, avec
code 1 : `TEST_DATABASE_URL` et `TEST_REDIS_URL` manquants. L'accès PostgreSQL
en lecture seule a aussi échoué. Aucun `EXPLAIN`, temps de tuile PostGIS,
mesure mémoire DB ou essai réel de concurrence BullMQ n'a donc été validé ici.

Un premier passage worker avait détecté un rejet non géré pendant l'en-tête
Parquet ; il a été corrigé et les tests couvrent cette panne. Les blocages
Windows d'esbuild ont nécessité de lancer Vitest hors sandbox, sans changer
les politiques système.

`npm.cmd audit --json` : code 1, 25 signalements (1 faible, 18 modérés,
4 élevés, 2 critiques), dans les dépendances déjà présentes, notamment
Vitest/Tinypool, Vite, Prisma et les outils ESLint/Swagger. Le rapport ne signale
pas `parquetjs-lite` ni ses nouvelles dépendances. Aucune mise à jour globale
ou `audit fix` hors Phase 4 n'a été effectuée. Le résultat vide de l'essai
`audit --offline` n'est pas considéré comme une validation de sécurité.

## 9. Commandes exactes de contrôle

Depuis la racine, sous PowerShell (`npm.cmd` évite le blocage de `npm.ps1`) :

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test --workspace @firebridge/api -- --run
npm.cmd run test --workspace @firebridge/worker -- --run
git diff --check
```

Les tests par défaut remplacent les URLs par des adresses unitaires inactives,
excluent les fichiers d'intégration existants et utilisent un répertoire
temporaire de stockage. Les mocks vérifient HTTP, sécurité, idempotence, SQL,
cycle worker et pannes ; ils ne remplacent pas un essai PostGIS réel.

Pour une infrastructure de test **déjà provisionnée et isolée**, dont les
migrations ont été vérifiées et déployées selon le processus habituel :

```powershell
$env:TEST_DATABASE_URL = 'postgresql://test:test@localhost:5432/firebridge_test'
$env:TEST_REDIS_URL = 'redis://localhost:6379/15'
npm.cmd run test:integration
```

Le nom de base doit se terminer par `_test`, Redis doit utiliser DB 1–15,
et les URLs doivent différer de celles du `.env`. Ne pas utiliser cette base
ou ce numéro Redis pour des données de développement/production. Le script ne
crée, ne réinitialise et ne migre pas automatiquement la base. Les fixtures SQL
sont conservées dans la base de test ; seuls les fichiers temporaires de test
sont nettoyés.

## 10. Vérification manuelle des routes

Brancher d'abord le vérificateur d'identité serveur, démarrer PostgreSQL/Redis,
l'API et le worker, puis utiliser une analyse autorisée compatible :

```powershell
npm.cmd run dev:api
# Dans un autre terminal :
npm.cmd run dev:worker
```

Dans un troisième terminal, en adaptant l'en-tête au véritable mécanisme
d'authentification installé (Bearer ci-dessous uniquement si ce vérificateur
est celui retenu) :

```powershell
$base = 'http://localhost:3000/api/v1'
$analysisId = '<UUID analyse ready/partial dont vous êtes demandeur>'
$auth = @{ Authorization = "Bearer $env:FIREBRIDGE_TEST_TOKEN" }
Invoke-WebRequest -Uri "$base/analyses/$analysisId/tiles/detections/0/0/0.mvt" -Headers $auth -OutFile './tile.mvt'
$headers = $auth.Clone()
$headers['Idempotency-Key'] = [guid]::NewGuid().ToString()
$created = Invoke-RestMethod -Method Post -Uri "$base/analyses/$analysisId/exports" -Headers $headers -ContentType 'application/json' -Body '{"format":"csv","filters":{},"options":{}}'
$jobId = $created.data.job_id
Invoke-RestMethod -Uri "$base/jobs/$jobId" -Headers $auth
# Tant que le job n'est pas succeeded, download renvoie 409.
Invoke-WebRequest -Uri "$base/jobs/$jobId/download" -Headers $auth -OutFile './export.csv'
```

Remplacer `csv` par `geojson` ou `parquet` pour les autres formats. Ne jamais
mettre de token dans l'URL. Sans hook d'authentification, un simple header
Bearer ne crée pas d'identité : le refus 401 est attendu.
