# FIREBRIDGE — audit initial de l’intégration backend/frontend

> État historique avant implémentation. La directive ultérieure impose une API publique sans authentification et conserve `/api/v1`. Voir le [rapport de livraison](INTEGRATION_REPORT.md) pour les corrections, migrations appliquées et résultats actuels.

Date : 4 novembre 2026. Périmètre : les dix endpoints des phases 0, 2 et 4 de la mission d’intégration. Ce document décrit l’état constaté ; il ne constitue pas une livraison de l’intégration complète.

## 1. Structure et architecture existantes

```text
projet nasa/
├── backend_FIREBRIDGE/               npm workspaces, TypeScript strict
│   ├── apps/api/src/
│   │   ├── config/                   environnement, Redis, logs
│   │   ├── routes/                   Fastify, préfixe /api/v1
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── repositories/             Prisma SQL paramétré et pg
│   │   ├── validators/               Zod
│   │   ├── middleware/               erreurs, idempotence, limites
│   │   └── utils/                    enveloppes, curseurs signés
│   ├── apps/worker/src/
│   │   ├── processors/               analyses et exports asynchrones
│   │   ├── services/                 outbox, récupération, nettoyage
│   │   ├── repositories/
│   │   ├── queues/                   BullMQ/Redis
│   │   └── exports/                  CSV, GeoJSON, Parquet
│   ├── packages/
│   │   ├── contracts/                contrats partagés du backend
│   │   ├── database/prisma/          schéma, SQL et sept migrations
│   │   ├── results/                  sélection native et stockage
│   │   ├── domain/                   socle partiellement préparé
│   │   ├── integrations/             adaptateurs encore préparatoires
│   │   └── observability/
│   ├── docs/
│   ├── scripts/
│   ├── docker-compose.yml
│   └── Dockerfile.api / Dockerfile.worker
└── front_firebridge-project/         projet npm indépendant
    └── src/
        ├── config/env.ts            fichier commencé, syntaxe invalide
        ├── lib/axios.ts             import seul, aucune instance
        ├── services/                santé commencée, api.keys.ts vide
        ├── App.tsx                  QueryClient et provider existants
        ├── data.ts / fixtures.ts    démonstration locale synthétique
        └── components/              interface existante à conserver
```

Le framework HTTP effectivement utilisé est **Fastify**, pas Express. Il est à conserver. L’organisation route → controller → service → repository existe déjà pour le périmètre demandé. Aucune nouvelle arborescence n’est nécessaire.

Les dépendances importantes du backend sont présentes : Fastify 5, Prisma 6, pg, ioredis, BullMQ, Zod, Pino et parquetjs-lite. Le frontend déclare React, Vite et TanStack Query ; **Axios n’est pas déclaré** et son dossier `node_modules` est absent dans cette copie. Les deux projets possèdent leur propre `package-lock.json`. Le frontend n’est pas un workspace du backend ; il n’existe pas encore de lien npm vers `@firebridge/contracts`.

## 2. Diagnostic et priorités

| Priorité | Constat vérifié | Conséquence / correction nécessaire |
| --- | --- | --- |
| Critique | La base active possède seulement la migration `20261030000000_firebridge_schema_v2`. Le dépôt attend un historique différent de sept migrations. | Réconcilier le schéma et l’historique après sauvegarde vérifiée. Ne pas lancer directement la chaîne additive sur cette base. Voir les avertissements existants de `PHASE_3.md`. |
| Critique | `analysis_request_keys` et `explanation_request_keys` sont absentes de la base active. | Le code courant utilise le registre d’idempotence des analyses, y compris lors de l’enregistrement d’un nouveau job. Le parcours d’écriture courant ne peut pas être déclaré compatible avec cette base. |
| Critique | Aucune identité utilisateur n’est vérifiée pour les ressources demandées. Analyses et exports utilisent `requested_by = 'anonymous'`. | Définir le mécanisme d’authentification attendu, puis vérifier la propriété avant lecture, réutilisation, accès au cache, export et téléchargement. L’adresse IP et un UUID ne sont pas une autorisation. |
| Haute | Les huit jonctions npm des workspaces pointaient vers l’ancien dossier `FIREBRIDGE`. | **Corrigé pendant l’audit** : elles pointent maintenant vers `backend_FIREBRIDGE`. Compilation et résolution npm vérifiées ensuite. |
| Haute | Les conteneurs et volumes actifs appartiennent au projet Compose `firebridge`, créé depuis l’ancien chemin. | Utiliser explicitement `docker compose -p firebridge ...` pendant la reprise. Un lancement avec le nom dérivé du nouveau dossier ne cible pas les services/volumes actifs et peut provoquer des conflits de noms. |
| Haute | `/api/v1/health/ready` renvoie 503 ; PostgreSQL et Redis sont prêts, mais le catalogue est indisponible. Douze releases sont publiées, aucun alias n’existe. | Examiner la servabilité et le scope des releases réelles avant publication d’un alias. Ne pas insérer un alias arbitraire pour rendre le healthcheck vert. |
| Haute | L’antiméridien n’est pas découpé avant stockage de la géométrie plane. | Normaliser/découper en MultiPolygon cohérent et tester trous, surface, intersections et équivalence. Le calcul de surface en `geography` seul ne corrige pas les intersections en `geometry`. |
| Haute | Le frontend ne compile pas : expression inachevée dans `src/config/env.ts`. | Implémenter et valider `VITE_API_URL`, puis installer Axios et les dépendances frontend avec le verrou existant. |
| Haute | Les chemins existants sont sous `/api/v1`, alors que la mission indique des chemins absolus sans ce préfixe. | Fixer explicitement le contrat des dix chemins avant leur connexion. Ne pas ajouter silencieusement des routes de compatibilité ni déplacer les autres endpoints. |
| Moyenne | Le QueryClient existe dans `App.tsx`, pas dans `lib`. | Extraire cette instance vers `lib` et conserver un seul provider ; aucun changement visuel nécessaire. |
| Moyenne | Les endpoints de santé renvoient un objet brut ; les autres réponses utilisent `request_id`, `schema_version`, `data`, `warnings`. | Uniformiser les réponses et mettre à jour les contrats/tests et le service frontend de santé. |
| Moyenne | La validation des zones utilise 10 000 positions par anneau et 50 000 000 km², alors que les paramètres de catalogue annoncent d’autres limites. | Faire appliquer les limites configurées à l’ensemble des anneaux ; valider le fuseau IANA. |
| Moyenne | La résolution des releases d’une analyse sélectionne la dernière release publiée par composant et date, sans filtre de scope ni de stream dans ces requêtes. | Vérifier et imposer la sélection compatible avec la zone et `standard_only`, dans la transaction existante. |
| Moyenne | Redis et l’API sont publiés sur toutes les interfaces ; PostgreSQL est lié à 127.0.0.1. | Conserver les communications internes par noms de services et restreindre l’exposition locale aux besoins réels. |
| Moyenne | Compose ne transmet pas actuellement la configuration CORS et la plupart des réglages résultats/exports. | Propager explicitement les variables nécessaires aux deux processus, en conservant leur stockage partagé et leurs volumes. |

Le fichier `services/tile-layers.ts` décrit un accès authentifié, mais ce contrôle n’est pas implémenté par le middleware actuel. Les tests existants de phase 4 demandent même explicitement qu’une tuile soit accessible sans jeton. Leur succès ne prouve donc pas le respect de l’exigence d’isolation de la mission.

## 3. Infrastructure constatée, sans changement des services

Docker Desktop est installé ici :

```text
C:\Users\Mohamed El Korchi\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe
```

Il n’est pas dans le PATH du processus restreint ; les contrôles Docker ont été exécutés hors du bac à sable. L’absence initiale de la commande ne signifiait pas que Docker était arrêté.

| Service actif | État observé | Publication réelle |
| --- | --- | --- |
| `firebridge-postgres` | healthy ; PostGIS 3.4 répond | `127.0.0.1:5432 → 5432` |
| `firebridge-redis` | healthy ; PING = PONG | `0.0.0.0:6379 → 6379`, IPv6 également |
| `firebridge-api` | processus vivant ; conteneur unhealthy à cause de la readiness | `0.0.0.0:3000 → 3000`, IPv6 également |
| `firebridge-worker` | healthy ; consommateurs actifs selon les logs | aucun port publié |

Les volumes réellement montés sont `firebridge_postgres_data`, `firebridge_redis_data` et `firebridge_exports_data`. API et worker partagent le volume d’exports. Aucun volume n’a été supprimé, remplacé ou vidé. Aucun conteneur n’a été recréé/redémarré pendant l’audit.

Compose utilise déjà `postgres:5432` et `redis:6379` pour les communications internes. Les dépendances attendent les healthchecks de PostgreSQL et Redis. Le worker possède son propre healthcheck et un délai d’arrêt. Les images s’exécutent avec l’utilisateur `node` et ne lancent aucune migration au démarrage.

Le nom de la base active est `firebridge`. Son registre Prisma est dans **`firebridge._prisma_migrations`**, pas dans `public`. Les index des zones, du cache d’analyse, des jobs et de l’outbox sont présents ; les index additionnels de la migration phase 4 ne figurent pas dans le relevé de la base active. Les contraintes spatiales sont définies dans le SQL ; Prisma représente les géométries avec `Unsupported("geometry")`. Les archives de migrations et le dump préexistant ont été laissés intacts.

## 4. Environnements à conserver et à compléter après déblocage

| Élément | État réel | Travail restant |
| --- | --- | --- |
| Backend/worker | Un `.env` partagé à la racine du backend est déjà chargé par les processus. | Compléter ce fichier existant ; ne pas créer des `.env` par application sans nécessité. |
| Base | URL locale vers `localhost:5432/firebridge` ; URL interne Compose vers `postgres:5432/firebridge`. | Préserver la base et ses données ; réconcilier son historique. |
| Redis | URL locale vers `localhost:6379` ; URL interne vers `redis:6379`. | Garder le port interne 6379 et une correspondance cohérente si le port hôte change. |
| Port API | Le code lit **`PORT`**, valeur 3000. L’hôte d’écoute est codé à `0.0.0.0`. | Décider si `API_PORT` est un alias ; ajouter une configuration d’hôte si nécessaire sans casser `PORT`. |
| CORS | Le code lit **`CORS_ORIGINS`**, liste séparée par virgules ; absent du `.env` actif. | Autoriser explicitement l’origine Vite et transmettre cette valeur à Compose. |
| Frontend | `.env.example` contient seulement les options de carte ; aucun `.env.local` existant. | Ajouter `VITE_API_URL` pour le navigateur, aligné sur le contrat de préfixe. Aucun secret serveur dans les variables Vite. |
| Résultats/worker | Les options de limites, rétention, concurrence et récupération existent dans `.env.example`. | Transmettre les valeurs utiles à API/worker et conserver le répertoire d’exports commun. |

Les valeurs secrètes du `.env` actif n’ont pas été copiées dans ce rapport. Aucun secret ni nouveau `.env` n’a été ajouté à Git. Certaines variables d’exemple pour des fournisseurs externes ne sont utilisées par aucun adaptateur fonctionnel ; elles ne constituent pas une intégration NASA/météo/IA.

## 5. État des dix endpoints demandés

Les routes ci-dessous désignent les suffixes demandés. Leur montage existant est sous **`/api/v1`**. Aucun endpoint n’a été ajouté, supprimé ou modifié pendant cet audit.

| Endpoint demandé | Implémentation existante réutilisable | Vérification obtenue / limite |
| --- | --- | --- |
| `GET /health/live` | controller/service sans accès base | Appel HTTP réel : `/api/v1/health/live` = 200 ; `/health/live` = 404. |
| `GET /health/ready` | probes PostgreSQL/Redis/catalogue avec délai borné | HTTP réel : `/api/v1/health/ready` = 503 ; `/health/ready` = 404. Dépendances prêtes, catalogue indisponible. |
| `POST /areas` | Zod, validation PostGIS, surface géodésique, insertion atomique/réutilisation | Tests ciblés avec mocks passent. Antiméridien et isolation à corriger ; pas d’écriture de zone sur la base active pendant l’audit. |
| `GET /areas/{area_id}` | géométrie, `area_cells`, grilles, `not_prepared` | Tests ciblés avec mocks passent. Contrôle de propriété absent. |
| `POST /analyses` | transaction REPEATABLE READ, composants/job/outbox, cache et registre d’idempotence | Tests ciblés avec mocks passent. Registre absent de la base active ; identité et sélection de release à corriger. |
| `GET /analyses/{id}` | état effectif, composants et job ; `partial` géré | Tests ciblés avec mocks passent. Contrôle de propriété absent. |
| `GET /jobs/{id}` | progression, stade, tentatives, retryabilité, expiration | Tests ciblés avec mocks passent. Contrôle de propriété absent. |
| `GET /analyses/{id}/tiles/{layer}/{z}/{x}/{y}.mvt` | couche blanche `detections`, XYZ, cache Redis, ST_AsMVT borné et agrégation | Tests de route/requête passent. Aucun rendu MVT réel complet sur une analyse active validé pendant cet audit ; autorisation absente. |
| `POST /analyses/{id}/exports` | job/outbox transactionnels, clé requise, worker distinct | Tests de route/repository passent. L’identité et les quotas sont actuellement globaux/anonymous. |
| `GET /jobs/{id}/download` | flux, métadonnées/fichier vérifiés, 409 en attente, 410 expiré | Tests ciblés passent. Le contrôle actuel vérifie la disponibilité des résultats, pas l’autorisation utilisateur. |

Les endpoints hors périmètre déjà présents n’ont pas été testés fonctionnellement ni modifiés. L’API active est issue d’une image préexistante ; elle n’a pas été reconstruite à partir de cette copie. Un succès HTTP sur cette image n’atteste pas à lui seul la compatibilité du code local et de la base.

## 6. Vérifications exécutées

| Vérification | Résultat |
| --- | --- |
| Node/npm | Node 24.22.1 ; npm 11.19.1. |
| `npm ls --depth=0 --offline`, backend, avant réparation | Échec ELSPROBLEMS : huit workspaces invalides, dépendances vues comme extraneous. |
| Même commande, après réparation des jonctions | **Succès**, workspaces et dépendances résolus. |
| `npm run build`, backend, avant réparation | Échec de résolution de `@firebridge/database` et `@firebridge/contracts`. |
| Même commande après réparation | **Succès**, packages nécessaires, API et worker compilés. Prisma Client régénéré localement ; aucune migration appliquée. |
| `npm run lint`, backend | **Succès**. |
| Tests API ciblés après réparation | **14 fichiers, 172 tests réussis**. Tests principalement unitaires et routes injectées avec doubles de dépendances. |
| Tests worker ciblés | **9 fichiers, 86 tests réussis**. Analyses, outbox, exports, formats, stockage, nettoyage, configuration et arrêt. |
| `npm run build`, frontend | Échec : dépendances non installées (`tsc` introuvable). |
| Analyse additionnelle avec le TypeScript déjà installé du backend | Confirme `TS1109` dans `src/config/env.ts`. Signale aussi une option inconnue du compilateur backend 5.7 (`erasableSyntaxOnly`) : ce dernier point ne constitue pas un défaut du compilateur frontend déclaré. |
| HTTP réel santé | 200 live et 503 ready sous `/api/v1`, 404 pour les deux chemins sans préfixe. |
| PostgreSQL/PostGIS/Redis | Répondent ; PostGIS 3.4 ; Redis PONG. |
| Antiméridien, SELECT PostGIS sans écriture | Pour l’anneau 179°/-179° entre -1° et 1° : géométrie valide, surface géodésique ≈49 238,89 km², mais intersection plane avec (0°,0°) vraie et avec (179,5°,0°) fausse. Le défaut de découpage est reproductible. |
| Tests bout en bout des écritures, MVT et téléchargements réels | **Non exécutés** sur la base active : incompatibilité de migration et absence d’authentification. Aucune donnée de démonstration insérée pour simuler leur réussite. |
| `git diff --check` | **Succès** pour les modifications suivies. |

Les exécutions Vitest ont nécessité de sortir du bac à sable, qui empêchait initialement esbuild de lire les répertoires parents. Cette erreur d’accès est distincte des jonctions cassées, confirmées également hors du bac à sable.

Commandes des suites ciblées, depuis les dossiers respectifs `apps/api` et `apps/worker` :

```powershell
# API
..\..\node_modules\.bin\vitest.cmd run tests/health.service.test.ts tests/health.controller.test.ts tests/areas.service.test.ts tests/areas.routes.test.ts tests/analyses.validator.test.ts tests/analyses.routes.test.ts tests/jobs.service.test.ts tests/jobs.routes.test.ts tests/results.routes.test.ts tests/idempotency.test.ts tests/cursor.test.ts tests/tiles.query.test.ts tests/exports.repository.test.ts tests/error-handler.test.ts

# Worker
..\..\node_modules\.bin\vitest.cmd run tests/analysis.processor.unit.test.ts tests/analysis-recovery.unit.test.ts tests/outbox-dispatcher.unit.test.ts tests/export.processor.unit.test.ts tests/export-formats.test.ts tests/export-storage.test.ts tests/export-cleanup.test.ts tests/env.unit.test.ts tests/shutdown-manager.unit.test.ts
```

Ces tests ne remplacent pas les tests réels de PostGIS, des transactions concurrentes et de la chaîne API → outbox → Redis → worker → fichier.

## 7. Changements effectués et travail restant

- Huit jonctions dans `node_modules/@firebridge` ont été réparées après vérification des chemins et de leurs anciennes cibles. Ces fichiers locaux ignorés par Git ne changent pas les manifestes ni les verrouillages.
- Le build a régénéré les sorties ignorées `dist` et le client Prisma.
- Ce rapport a été ajouté et référencé dans le README existant.
- Aucune source applicative, interface, route, table, migration, configuration Compose ou variable d’environnement n’a été modifiée.
- Les fichiers non suivis préexistants, les archives et les sauvegardes ont été conservés. Les commits et paramètres Git globaux n’ont pas été modifiés.

La mission demande expressément de ne pas poursuivre l’étape suivante en présence d’erreurs critiques. La configuration et l’implémentation de l’intégration complète restent donc à réaliser après résolution de ces prérequis :

1. Réconcilier la base historique sans effacement : vérifier une sauvegarde restaurable, comparer son schéma à celui attendu, puis préparer une reprise de baseline et les ajouts réellement manquants. Ne pas réécrire manuellement le registre Prisma ni appliquer le SQL consolidé par-dessus l’existant. Une base de test séparée peut valider la procédure, mais ne remplace pas la reprise de la base active.
2. Identifier le mécanisme d’identité retenu et la règle de propriété des zones/analyses/jobs existants. Aucun identifiant fourni librement par le navigateur ne doit devenir une identité de confiance.
3. Fixer le préfixe HTTP des dix endpoints en tenant compte des chemins absolus de la mission et des routes versionnées déjà présentes.

Une fois ces points résolus, conserver l’ordre de la mission : configuration Docker/environnement, socle et phases backend 0/2/4, Axios unique dans `lib`, extraction du QueryClient existant, services typés, hooks utilisés et validation de bout en bout. Le frontend de démonstration reste actuellement basé sur ses fixtures ; il n’est pas connecté aux résultats réels. Aucun service ou hook manquant n’est présenté comme livré par cet audit.
