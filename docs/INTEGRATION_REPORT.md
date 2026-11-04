# FIREBRIDGE — livraison de l’intégration publique

4 novembre 2026. Ce rapport remplace les décisions d’authentification et de préfixe laissées ouvertes dans l’audit initial. Les dix endpoints en périmètre utilisent `/api/v1` et sont **publics, sans comptes, identité utilisateur, jetons ou cookies d’authentification**. Quiconque peut joindre l’API peut consulter ces ressources. Aucun isolement de données privées par utilisateur n’est revendiqué.

## Implémentation livrée

L’architecture existante est conservée : Fastify, TypeScript strict, Prisma/PostGIS, ioredis/BullMQ et worker indépendant. Aucun endpoint n’a été ajouté ni supprimé. Les pages, composants visuels, styles et données de démonstration affichées ne sont pas modifiés. `App.tsx` importe simplement le QueryClient extrait dans `lib` ; les services/hooks réels ne sont pas branchés aux pages.

| Élément | État réel |
| --- | --- |
| ENV frontend | Syntaxe corrigée, `VITE_API_URL` validée ; défaut `http://localhost:3000/api/v1`. URL HTTP(S) absolue, sans identifiants/query/fragment, préfixe obligatoire. |
| Axios | Une instance dans `src/lib/axios.ts` ; délai 15 s, 60 s pour les fichiers, JSON, normalisation erreurs réseau/HTTP/timeout et erreurs JSON binaires. Annulation conservée comme telle. Aucune configuration d’authentification. |
| QueryClient | L’instance existante est extraite ; un provider conservé. `staleTime=30 s`, `gcTime=5 min`, deux reprises maximum seulement pour erreurs transitoires, aucune reprise automatique des mutations. |
| Services | Santé, zones, analyses, MVT, jobs, exports et téléchargement ; tous utilisent Axios et les DTO de `@firebridge/contracts`. |
| Hooks | Dix hooks dans `src/hooks/useFirebridge.ts`, clés centralisées, déduplication des lectures, annulation à la désinscription, mutations et invalidations ciblées. Polling borné aux états `queued`/`running`. |
| Socle backend | Enveloppe commune sur la santé également, erreurs centralisées, préfixe versionné conservé, CORS explicite, curseurs signés et idempotence existante réutilisés. |
| Analyses publiques | Transactions REPEATABLE READ ; constantes `native_detections_v1`, grille nulle, `standard_only` ; sélection des releases dans le scope configuré et le stream rétrospectif. Cache et idempotence sans identité. |
| Concurrence | Attente d’acquisition Prisma explicitement bornée à 5 s ; transaction bornée à 10 s ; reprise des conflits et des acquisitions transitoires. Le test HTTP concurrent a reproduit puis vérifié la correction du défaut P2028. |
| Zones/PostGIS | Limite totale de sommets et surface depuis ENV, fuseau IANA validé, sommets déroulés avant validation, découpage ST_WrapX à ±180°, trous conservés ; hash stable pour inversion/rotation des anneaux. Les anciennes zones sont aussi normalis?es ? la lecture sans r??criture de leur stockage. |
| Tuiles | Couche `detections`, XYZ validé, sélection réelle figée, agrégation bornée, cache Redis et limites de taille/temps/débit existants. Aucun point de carte inventé. |
| Exports | Jobs/outbox transactionnels, quotas publics globaux, génération uniquement dans le worker, fichiers contrôlés et téléchargements en flux. |
| Liens de fichier | `GET /jobs/{id}` retourne `download_url` pour un export réussi et non expiré. Signature HMAC distincte des curseurs, valable au maximum cinq minutes et jamais après l’expiration du fichier. Le téléchargement vérifie la signature avant d’ouvrir le fichier. Ce lien public ne représente aucune permission utilisateur. |

Les colonnes historiques `requested_by` restent physiquement présentes pour conserver les données et les anciennes structures. Elles deviennent facultatives pour les jobs et les clés d’analyse ; **les nouveaux workflows en périmètre ne les lisent ni ne les renseignent**. Aucune valeur `anonymous`, faux compte ou propriétaire n’est ajouté. Les tests réels vérifient des valeurs NULL pour tous les nouveaux jobs et clés. Aucune colonne de propriété n’existe dans la migration livrée.

La clé d’idempotence est publique/globale : utiliser `createIdempotencyKey()` et conserver cette clé pour rejouer le même intent. Un payload différent sous la même clé reçoit 409. Le cache des résultats reste lié aux paramètres et aux releases sélectionnées. Les anciens résultats ne sont pas réécrits ; le schéma de hash évolue pour les nouvelles demandes publiques.

## Les dix endpoints et leurs contrats

| Méthode / chemin, après `/api/v1` | Résultat vérifié |
| --- | --- |
| `GET /health/live` | 200 sans requête de disponibilité. |
| `GET /health/ready` | 200 avec catalogue servable en test ; 503 avec catalogue absent ; probes PostgreSQL/Redis/catalogue bornés. |
| `POST /areas` | 201 à la création, 200 à la réutilisation ; validation PostGIS réelle. |
| `GET /areas/{area_id}` | Géométrie, surface et couverture ; `not_prepared` en l’absence de poids. |
| `POST /analyses` | 202 puis 200 pour un rejeu ; deux requêtes concurrentes reviennent à la même analyse. Job et outbox persistés. |
| `GET /analyses/{id}` | Composants, état et job ; `partial` obtenu après exécution du worker avec satellite seul. |
| `GET /jobs/{id}` | État, progression, tentatives, retryabilité, expiration et lien éventuel. |
| `GET /analyses/{id}/tiles/{layer}/{z}/{x}/{y}.mvt` | Octets MVT produits par PostGIS ; coordonnées invalides et couche inconnue refusées. |
| `POST /analyses/{id}/exports` | 202, job/outbox et réutilisation d’idempotence ; CSV, GeoJSON et Parquet exécutés par un processus worker distinct. |
| `GET /jobs/{id}/download?expires=…&signature=…` | Octets du fichier signé ; 409 si en attente, 410 si fichier expiré, 400 si signature manquante/invalide pour un fichier disponible, 410 si lien expiré. |

Les réponses JSON utilisent :

```json
{"request_id":"…","schema_version":"1","data":{},"warnings":[]}
```

Les réponses métier conservent aussi leurs champs `status` et `message`. Une erreur contient `data:null`, `code`, `message` et `error:{code,message}` sans détail SQL ou chemin privé. La readiness indisponible est un 503 avec ses checks dans `data`. MVT et téléchargements sont des réponses binaires ; ils ne sont pas enveloppés en JSON. `Content-Disposition`, `Location`, `Retry-After` et les identifiants de requête utiles sont exposés par CORS.

## Réconciliation de la base

La migration consolidée `20261030000000_firebridge_schema_v2` a été retrouvée dans Git avec **exactement** le checksum déjà appliqué, en préservant ses octets CRLF : `4aa08228ff22caf52441a5141f7dc6dfa681f27792d371466016f391ef0e9c25`.

`PRISMA_MIGRATION_HISTORY=legacy` assemble un historique compatible dans `.data/legacy-migrations/<empreinte>`, en conservant cette migration puis en réutilisant directement les migrations additives courantes à partir du registre des clés d’analyse. Aucun enregistrement de `_prisma_migrations` n’est réécrit manuellement. Le mode `shared`, pour base neuve, garde l’historique original du dépôt. Les deux chemins ont été appliqués et comparés sur des bases isolées.

La migration nouvelle `20261104000000_public_requests` rend facultative la métadonnée historique de demandeur et rend l’idempotence globale. Elle refuse d’agir si des clés historiques sont ambiguës ; aucune ligne n’est supprimée pour résoudre un conflit. Elle ne crée aucune table ni colonne d’authentification.

La reprise de la base locale `firebridge` a été appliquée le 4 novembre 2026 après sauvegarde, contrôle SHA-256, restauration de vérification et comparaison des colonnes et contraintes applicatives. **Les empreintes de toutes les lignes des 48 tables d’origine sont identiques avant/après.** Les sauvegardes et preuves restent dans `.data/integration/` (ignoré par Git) :

- `reconciliation-result.json` : validation isolée et empreintes ;
- `applied-reconciliation.json` : application locale et conservation des lignes ;
- `backup-20261104210944863.dump` : sauvegarde restaurée et vérifiée, SHA-256 `9c183d75d516daafd41054ec9715f7d1d9e11e6b64508320b3036472899f4c9d` ;
- `http-result.json` : résultat du parcours réel API/worker/HTTP.

Les scripts de validation et d’application sont gardés : ils refusent une base inattendue, un historique inconnu, une sauvegarde modifiée, une migration modifiée depuis sa validation ou des données actives modifiées depuis le snapshot. Le script d’application correspond à la reprise déjà effectuée et refuse une nouvelle application si l’historique actif a changé. Ne pas lancer un reset ou le SQL consolidé sur l’existant.

## Environnements, Docker et démarrage

Le `.env` partagé existant du backend/worker est conservé et complété avec `API_HOST`, `CORS_ORIGINS`, le scope et le choix d’historique. Aucun secret réel n’a été ajouté aux fichiers suivis. Le frontend possède un `.env.local` public contenant l’URL API ; `.env` est également ignoré par Git.

| Variable | Usage |
| --- | --- |
| `DATABASE_URL` | Locale pour les processus Windows ; `postgres:5432` dans Compose. |
| `REDIS_URL` | Locale pour les processus Windows ; `redis:6379` dans Compose. |
| `PORT` / `API_HOST` | API : 3000 ; hôte local en développement Windows, `0.0.0.0` dans le conteneur. Le code conserve `PORT` ; aucun alias `API_PORT` nécessaire. |
| `CORS_ORIGINS` | Liste explicite, normalement `http://localhost:5173`. Le mode développement n’autorise plus toutes les origines lorsque la liste est vide. |
| `DEFAULT_SCOPE_KEY` | Scope de sélection/catalogue ; ne publie aucune donnée automatiquement. |
| `CURSOR_SECRET` | Secret serveur existant des curseurs ; HMAC avec domaine distinct pour les liens de fichier. Jamais envoyé au navigateur. |
| `PRISMA_MIGRATION_HISTORY` | `legacy` sur la base locale reprise ; `shared` pour une base neuve. |
| `EXPORT_MAX_ACTIVE` | Nombre global d’exports simultanés ; remplace le nom trompeur `EXPORT_MAX_ACTIVE_PER_USER`. Les autres limites/délais sont dans `.env.example`. |
| `VITE_API_URL` | URL HTTP exposée incluant `/api/v1`, configurée au démarrage/build Vite. |

Compose utilise explicitement le nom `firebridge`, les services et volumes existants. PostgreSQL, Redis et l’API restent aux ports 5432, 6379 et 3000, liés à `127.0.0.1`. Le worker n’expose aucun port HTTP. API/worker partagent `firebridge_exports_data` et leurs limites de résultat sont transmises par la configuration Compose commune. PostgreSQL et Redis conservent leurs volumes. Les dumps, sauvegardes et artefacts personnels sont exclus du contexte d’image.

Depuis le backend, sous PowerShell :

```powershell
npm.cmd ci
npm.cmd run build
docker compose -p firebridge up -d postgres redis
# La base locale est déjà réconciliée. Pour les ajouts futurs, avec l’historique approprié :
npm.cmd run prisma:deploy --workspace @firebridge/database
npm.cmd run dev:api
# Dans un autre terminal, pour un worker Windows :
npm.cmd run dev:worker
```

Pour utiliser les applications dans Docker, après vérification des migrations :

```powershell
docker compose -p firebridge build api worker
docker compose -p firebridge up -d api worker
docker compose -p firebridge ps
```

Depuis le frontend, après installation des dépendances backend :

```powershell
npm.cmd ci
npm.cmd run dev
```

`predev` et `prebuild` du frontend compilent le package de contrats partagé existant. L’URL de base est configurée dans `.env.local` ; aucune connexion des pages n’est effectuée automatiquement.

## Vérifications et limites réelles

| Vérification | Résultat |
| --- | --- |
| Build backend et TypeScript strict | Réussis pour API, worker et packages nécessaires. |
| Lint backend | Réussi. |
| API ciblée | **174 tests réussis**, dont erreurs, idempotence, curseurs, validation des coordonnées, liens signés, 409/410 et erreurs Redis simulées. |
| Worker ciblé | **86 tests réussis** : processeurs, outbox, streaming/formats, stockage, nettoyage, récupération et arrêt. |
| Build, lint et tests frontend | Build/lint réussis ; **64 tests réussis**. Les 8 tests HTTP sont volontairement sautés dans la suite unitaire ordinaire. |
| Hooks | Tests réels du cycle React : lecture dupliquée dédupliquée, invalidation d’une seule zone, ID absent non interrogé, annulation au démontage. |
| Intégration HTTP | **8 tests réussis** avec les services Axios réels, PostGIS/Redis et un worker séparé. Aucun mock de connexion. CSV/GeoJSON : trois détections ; Parquet : fichier réel valide en tête. |
| Contrôles HTTP/SQL supplémentaires | Antiméridien avec trou, réutilisation après inversion d’anneaux, géométrie croisée rejetée, absence d’identité dans les nouveaux enregistrements, lien altéré refusé, CORS, états 409/410 et readiness 503 sans alias. |
| Données des tests HTTP | Observations explicitement synthétiques `TEST ONLY`, exclusivement dans une base neuve `firebridge_http_<horodatage>_test`. Redis utilise une base numérotée initialement vide, différente de la base active ; aucune clé préexistante n’est effacée. |
| Réconciliation | Historique legacy restauré et historique shared neuf validés ; données actives conservées après application. |

Commandes de contrôle : `npm.cmd run build`, `npm.cmd run lint`, `npm.cmd run typecheck` côté backend ; `npm.cmd run build`, `npm.cmd test`, `npm.cmd run lint` côté frontend. Les commandes des suites API/worker ciblées sont dans l’audit, avec en plus `tests/download-link.test.ts` pour l’API.

Le parcours réel se relance depuis le backend avec `node scripts/integration/run.mjs` après compilation. Il crée une nouvelle base de test, y applique les migrations, charge les seules fixtures de test, démarre une API sur `127.0.0.1:3301` et un worker séparé, exécute les services frontend sur HTTP puis les contrôles SQL/HTTP, et arrête ces deux processus. Les bases/fichiers de test et logs sont conservés pour inspection. Il ne nettoie aucun volume ni base existante.

Lors de cette livraison initiale, la base active contenait douze releases satellites publiées dans le scope `global`, **zéro alias, zéro partition et zéro détection** ; sa readiness restait donc à 503. Le 4 novembre 2026, une mission ultérieure a chargé de manière additive un [catalogue de test explicitement synthétique](TEST_DATA.md), complet et traçable, dans le scope `morocco`. La readiness répond désormais 200. Ce changement ne prouve toujours pas la présence d’observations NASA réelles : les 36 détections ajoutées sont marquées `SYNTHETIC_TEST`, sans mesures scientifiques fabriquées.

Le build Vite conserve l’avertissement préexistant sur les gros chunks MapLibre/ECharts. L’audit npm de production consulté pendant la construction signale six alertes transitives, dont trois hautes, et aucune critique ; la chaîne Prisma/config et les dépendances de fichiers statiques nécessitent une maintenance dédiée. Aucun `audit fix --force` ni changement majeur non vérifié n’a été appliqué.

## Fichiers réutilisés, créés et modifiés

Les controllers, services, repositories, validateurs, l’outbox, les processeurs et le stockage existants sont réutilisés. Les hooks et services suivent leurs dossiers existants ; aucun dossier de projet n’est renommé.

**Créés :**

- Backend : `packages/contracts/src/http.ts`, `apps/api/src/utils/download-link.ts`, `apps/api/tests/download-link.test.ts`, `apps/api/tests/analyses.service.test.ts`, `packages/database/prisma/migrations/20261104000000_public_requests/migration.sql`, `packages/database/prisma/sql/legacy_baseline_20261030000000.sql`, `.gitattributes`.
- Reprise et tests : `scripts/database/state.mjs`, `scripts/database/validate-reconciliation.mjs`, `scripts/database/apply-reconciliation.mjs`, `scripts/integration/run.mjs`, `scripts/integration/seed.mts`, `scripts/integration/checks.mjs`, `scripts/populate-existing.mjs`.
- Frontend : `src/lib/queryClient.ts`, `src/lib/api.test.ts`, `src/services/areas.service.ts`, `src/services/analyses.service.ts`, `src/services/jobs.service.ts`, `src/services/firebridge.integration.test.ts`, `src/hooks/useFirebridge.ts`, `src/hooks/useFirebridge.test.tsx`, `.env.local` local ignoré.
- Documentation : ce rapport, `docs/TEST_DATA.md` ; l’audit initial a été conservé et marqué comme historique.

**Complétés/modifiés :**

- Frontend : `src/config/env.ts`, `src/lib/axios.ts`, `src/services/health.service.ts`, `src/services/api.keys.ts`, les imports/instance dans `src/App.tsx`, `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `README.md`.
- Backend : `app.ts`, `server.ts`, `config/env.ts`, controllers santé/analyses/résultats ; repositories analyses/zones/exports/jobs et retrait de la m?tadonn?e inutilis?e du repository worker d?export ; services analyses/zones/exports/jobs et registre de couches ; validateurs analyses/zones ; idempotence et hash de cache ; enveloppe ; types et client Prisma/configuration ; configuration des limites de résultats et export des contrats.
- Vérification : attentes des tests santé, zones, idempotence et téléchargement adaptées aux contrats réellement livrés ; garde de fixture étendue uniquement aux bases HTTP dédiées.
- Infrastructure/documentation : `docker-compose.yml`, `Dockerfile.worker` (ordre de copie align? pour le cache), `.dockerignore`, `.env.example`, `.env` local ignoré et `README.md`.

Aucun fichier, dump ou volume préexistant de l’utilisateur n’est supprimé. Les jonctions npm réparées pendant l’audit restent locales et ignorées. Tous les ajouts d’authentification introduits puis retirés pendant le travail sont absents des sources et des dépendances livrées.
