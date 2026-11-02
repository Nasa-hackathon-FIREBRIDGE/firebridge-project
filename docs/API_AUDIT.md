# Audit FIREBRIDGE — 31 octobre 2026

> Historical report from the Phase 4 branch. For the merged implementation, current fixture v2, actual identity behavior and fresh validation, see [integration report](PHASE_4_REVIEW.md).

L’audit a comparé les sources TypeScript, le `dist` local, les fichiers compilés
des conteneurs actifs, les routes HTTP et le catalogue PostgreSQL réel. Les
résultats exécutés sont consignés dans [API_TEST_REPORT.md](API_TEST_REPORT.md).
Les services historiques sont conservés à la demande de l’utilisateur. L’API
corrigée se vérifie sur **127.0.0.1:3104**, dans des conteneurs distincts.

## Constats et corrections

| Constat vérifié | Conséquence | Correction |
|---|---|---|
| Le conteneur API historique n’enregistre pas les deux routes imbriquées Phase 4 ; le worker historique ne charge que `analysis.requested`. | Le 404 observé sur la tuile est le gestionnaire global « Resource not found. », avant toute recherche spatiale. | Construction des images à partir des sources actuelles, vérification des routes OpenAPI et démarrage des seuls conteneurs `firebridge-audit-*`. |
| La base `firebridge` contient 14 analyses et 14 jobs, aucune détection. | Cette base n’est pas vide ; une analyse existante ne garantit pas une tuile peuplée. | Sauvegarde, restauration complète vérifiée, puis fixture dans une autre base. Aucune réattribution des analyses anonymes. |
| La première requête MVT réelle sur l’image corrigée expose SQLSTATE 42803. Des interpolations distinctes de la taille de cellule dans SELECT et GROUP BY deviennent des paramètres SQL différents. | Erreur de regroupement malgré des expressions TypeScript identiques. | `GROUP BY 1` regroupe exactement l’expression sélectionnée, sans SQL fourni par le client. |
| Aucun vérificateur d’identité n’était raccordé au serveur standard ; certaines listes/détails restaient accessibles sans propriétaire. | Accès privé incohérent et risque IDOR. | Authentification obligatoire des analyses/jobs/résultats, listes et curseurs liés au demandeur, création/réutilisation d’analyse liée au propriétaire. |
| GET `/jobs` était encore un scaffold. | Impossible de suivre une liste de jobs privés. | Liste bornée, filtrée et paginée, DTO sans chemins ni spécifications privées. |
| Les contrôles d’identité de création source/AOI étaient absents. | Écritures non authentifiées. | Permissions `sources:write` et `analyses:write` ; idempotence source isolée par acteur. Les lectures de métadonnées restent publiques selon le contrat existant. |
| L’état effectif d’une analyse queued pouvait être présenté partial avant le worker. | Faux signal de disponibilité. | Calcul partial réservé aux états terminés ready/partial. |
| Documentation Swagger statique vide et absence de logs normaux de requête. | Routes difficiles à diagnostiquer. | OpenAPI généré depuis Fastify ; logs méthode, modèle de route, statut, durée et requestId, sans token/body/query. |
| Des erreurs Prisma pouvaient exposer leur code fournisseur dans le contrat HTTP. | Fuite de détails techniques. | Code générique pour les exceptions internes 5xx non applicatives. |
| Les images n’avaient pas de contrôle de santé réel du worker. | Un processus présent ne prouve pas que les processors tournent. | Heartbeat Redis par instance, CLI de santé vérifiant analyse/export, healthchecks Docker. |
| Les tests d’intégration concurrents et l’outbox non bornée récupéraient des événements d’autres fixtures. | Résultats non reproductibles sur une base conservée. | Fichiers d’intégration séquentiels, scope d’agrégats paramétré pour le dispatcher de test ; comportement de production inchangé. |
| Prisma chargé dans le lanceur avant `prisma generate` verrouille sa DLL Windows. | EPERM pendant le workflow. | Snapshot PostgreSQL dans un sous-processus qui se termine avant le build. |

Le refus de remplacer les services historiques est respecté : aucun `up` ou
redémarrage du projet Compose initial n’est inclus dans le lanceur d’audit.
La construction des images ne remplace pas les conteneurs existants.

## Architecture et contrats vérifiés

Les routes délèguent aux controllers, puis aux services/repositories existants.
`packages/results` centralise sélection spatiale, contrats, configuration et
stockage partagé entre API et worker. Les contrôles Zod ne sont pas désactivés.

Toutes les URL ci-dessous ont le préfixe `/api/v1`.

| Endpoints implémentés | Accès | Réponses principales |
|---|---|---|
| GET `/health/live`, GET `/health/ready` | public | 200 ; readiness 503 si dépendance indisponible |
| GET `/sources` | métadonnées publiques, pagination | 200 / 400 / 503 |
| POST `/sources` | `sources:write`, Idempotency-Key | 201 / 400 / 401 / 403 / 409 / 503 |
| GET `/areas`, GET `/areas/:area_id` | métadonnées publiques | 200 / 400 / 404 / 503 |
| POST `/areas` | `analyses:write` | 201 créée, 200 réutilisée / 400 / 401 / 403 |
| GET `/analyses`, GET `/analyses/:id` | `analyses:read`, propriétaire | 200 / 400 / 401 / 403 / 404 |
| POST `/analyses` | `analyses:write` | 202 créée, 200 réutilisée / 400 / 401 / 403 / 409 |
| GET `/analyses/:id/tiles/:layer/:z/:x/:y.mvt` | `analyses:read`, propriétaire | 200 binaire même vide / 400 / 401 / 403 / 404 / 409 / 429 / 503 |
| POST `/analyses/:id/exports` | `exports:create`, propriétaire, Idempotency-Key | 202 / 400 / 401 / 403 / 404 / 409 / 429 / 503 |
| GET `/jobs`, GET `/jobs/:id` | `jobs:read`, propriétaire | 200 / 400 / 401 / 403 / 404 |
| GET `/jobs/:id/download` | `jobs:download`, propriétaire du job et de l’analyse | 200 stream / 400 / 401 / 403 / 404 / 409 non réussi / 410 expiré ou absent / 429 / 500 contrôlée |

Les 24 routes suivantes sont **planifiées**, et leur réponse 501 est testée.
Leur fonctionnalité métier n’est pas déclarée implémentée :

| Ressource | Routes |
|---|---|
| catalog | GET `/catalog`, GET `/catalog/:id` |
| releases | GET `/releases`, GET `/releases/:id` |
| updates | GET `/updates`, POST `/updates` |
| detections | GET `/detections`, POST `/detections` |
| tiles | GET `/tiles`, GET `/tiles/:tileId` |
| cells | GET `/cells`, GET `/cells/:cellId` |
| weather | GET `/weather`, GET `/weather/:locationId` |
| reports | GET `/reports`, POST `/reports` |
| provenance | GET `/provenance`, GET `/provenance/:id` |
| explanations | GET `/explanations`, POST `/explanations` |
| exports | GET `/exports`, POST `/exports` |
| admin | GET `/admin/status`, POST `/admin/refresh` |

Les anciennes routes génériques `/tiles` et `/exports` ne sont pas les routes
imbriquées Phase 4. L’inventaire effectif est aussi accessible à `/api-docs/json`.

## Base, relations et index

PostgreSQL **16.4**, PostGIS **3.4.3**, extension dans le schéma `firebridge`.
Les tables métier sont dans ce même schéma. Le paramètre de connexion du
processus de test est adapté pour les fonctions PostGIS non qualifiées ; aucun
ALTER ROLE/DATABASE ni changement du `.env` n’est nécessaire.

Les 48 tables métier sont comparées par nombre de lignes et SHA-256 du contenu
JSON trié avant/après. Le backup custom est contrôlé par SHA-256 entre le
conteneur et le fichier local puis restauré dans une nouvelle base. La
restauration exclut uniquement CREATE SCHEMA public, déjà présent dans template0.
Elle ne cible jamais la base existante.

Les relations et données minimales sont détaillées dans
[TEST_FIXTURES.md](TEST_FIXTURES.md). Il n’existe pas de colonne
`detections.analysis_id` ni de FK directe job/outbox. L’appartenance aux
résultats passe par release/partitions, AOI, intervalle UTC et politique standard.

L’index GiST `detections_geom_gist` existe déjà. La migration additive
`20261031000000_phase4_serving_indexes` propose quatre index de jobs pour accès,
quotas et expiration ; **elle n’a pas été appliquée à la base historique**.
Aucune table ni colonne métier supplémentaire n’a été créée par cet audit.

## Sécurité et limites

- Aucun `X-User-Id` ou Bearer non vérifié ne fournit une identité. Le hook
  `createApp({ authenticate })` attend un vérificateur de déploiement de confiance.
- L’auth de test utilise des tokens opaques aléatoires, empreintes SHA-256,
  expiration et permissions explicites. Fichiers ignorés dans `.data/audit`,
  montage en lecture seule ; activation refusée hors NODE_ENV=test, base *_test
  et Redis 1–15. Le port Docker de test est publié sur 127.0.0.1 uniquement.
- Une ressource privée étrangère retourne 404 ; une identité sans permission
  reçoit 403 ; une identité absente/invalide/expirée reçoit 401.
- Autorisation avant lecture du cache. Clé Redis incluant analyse, acteur,
  version/cache_key, release, état, completed_at et XYZ. TTL 60 s, HTTP
  `private, no-store`. Les releases publiées sont considérées figées ; des
  changements hors de ce contrat nécessitent de versionner/invalider les résultats.
- Liste blanche `detections`, UUID et XYZ stricts, SQL paramétré, propriétés MVT
  limitées à count/frp_mw. Aucune table ni expression SQL choisie par l’utilisateur.
- Rate limits Redis par acteur : tuiles 120/min, exports 5/min, download 30/min.
  Quotas SQL sous verrou transactionnel : 2 exports actifs, 10/heure par acteur.
- Export limité à 1 million de lignes, 256 Mio, 300 s, lots 1000 ; concurrence
  worker 2 (configurable 1–4). Les cellules texte surdimensionnées sont rejetées.
- CSV neutralise les préfixes dangereux ; fichiers créés temporairement puis
  renommés, clés contrôlées, protection des chemins et liens symboliques,
  téléchargement stream. Aucun fournisseur externe ni URL permanente.
- Rétention normale 86400 s ; worker d’audit 180 s et nettoyage toutes les 10 s.
  Les tests attendent l’expiration naturelle, sans modifier les dates SQL.

## Performance et fiabilité

ST_TileEnvelope borne la requête ; filtres GiST `&&` et ST_Intersects précèdent
ST_Transform et ST_AsMVTGeom. Une grille spatiale dépendant du zoom agrège les
points en conservant count et le FRP maximum, sans LIMIT arbitraire. La géométrie
Point ne nécessite pas de simplification de lignes/polygones.

Les exports utilisent une pagination par ID, un snapshot RepeatableRead et la
contre-pression des streams. Parquet conserve un groupe borné de lignes.
L’API ne génère aucun export volumineux. Job/outbox sont créés dans une même
transaction ; le dispatcher existant utilise SKIP LOCKED et des leases. Les
exports ont une queue dédiée, trois tentatives, des claims SQL et une finalisation
conditionnelle à la lease. Les tests provoquent de vraies erreurs de stockage
pour vérifier retry réussi et échec final.

EXPLAIN ANALYZE, timings sur 10000 détections et mémoire RSS de deux exports
concurrents sont enregistrés pendant les tests. Ce sont des mesures locales,
pas une qualification de capacité de production.

## Limites restantes

Le serveur historique sur 3000 reste sur son ancienne image par choix explicite.
Un fournisseur d’identité normal doit encore être intégré au déploiement ; le
mécanisme de test n’en est pas un. Les analyses historiques `anonymous` ne sont
pas réattribuées. Les 24 scaffolds restent 501. Le build signale des vulnérabilités
npm déjà présentes ; aucun `audit fix --force` ni mise à jour globale n’a été fait.
La disponibilité du stockage local partagé et la conservation de Redis restent
des prérequis opérationnels. Aucune URL signée n’est utilisée.

## Principaux fichiers concernés

- API : `app.ts`, `auth/test-auth.ts`, controllers/routes/services/repositories
  analyses, jobs, sources, areas et résultats ; validators jobs/results,
  middleware results-access/error-handler, curseurs signés.
- Partagé : `packages/results/src/{contracts,config,detections.repository,storage}.ts`.
- Worker : exports, processor, repository, queue, dispatcher, cleanup,
  heartbeat/health et arrêt propre.
- Tests : suites API/worker, fixture, intégration Phase 4 et infrastructure isolée.
- Exécution : Dockerfiles, Compose audit/healthchecks, `scripts/phase4`,
  `scripts/audit`, `scripts/run-integration.mjs`, scripts npm.

L’état exact des fichiers créés/modifiés reste consultable avec `git status --short`.
Aucun commit ni push n’a été effectué.
