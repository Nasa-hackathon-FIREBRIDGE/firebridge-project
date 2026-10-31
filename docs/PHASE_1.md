# Phase 1 — Catalogue et versions : contrat d’intégration

Ce document décrit les conventions nécessaires au raccordement entre les endpoints et la publication des données. Les paramètres et réponses HTTP sont dans [API.md](../API.md) ; le démarrage et les vérifications sont dans le [README](../README.md).

## Périmètre livré

| Endpoint                            | Responsabilité                                           |
| ----------------------------------- | -------------------------------------------------------- |
| `GET /api/v1/catalog`               | Sources, métriques et releases courantes d’un scope      |
| `GET /api/v1/releases/{release_id}` | Métadonnées et membres paginés d’une release publiée     |
| `GET /api/v1/updates`               | Comparaison des aliases courants avec une release connue |

Les lectures de phase 1 utilisent une transaction `REPEATABLE READ READ ONLY`. Elles ne déclenchent ni acquisition fournisseur, ni publication de release, ni migration.

Le [SQL de conception](../packages/database/prisma/sql/firebridge_schema_v2.sql) décrit le schéma attendu. Les deux premières migrations créent `public.HealthCheck` et `firebridge.sources`. La migration `20261031000000_phase1_catalog_versions` ajoute PostGIS et les 15 tables nécessaires à ces lectures, avec leurs clés étrangères, contraintes et index. Les tables des phases suivantes ne sont pas créées. Le SQL de conception ne doit pas être appliqué par-dessus les migrations existantes.

## Contrat à respecter côté ingestion

### Releases publiées

Les lignes de `data_releases` doivent avoir `status=published` et une date `published_at`. Les aliases ciblent une release du même `scope_key`. La publication des membres et le déplacement de l’alias doivent être atomiques.

Clés attendues dans `data_releases.config` :

```json
{
  "metric_ids": ["native_detections_v1"],
  "grid_ids": [],
  "manifest_sha256": "empreinte réelle du manifeste : 64 caractères hexadécimaux"
}
```

Le digest descriptif de cet exemple doit être remplacé par une empreinte réelle.

- `metric_ids` référence `metric_definitions`. Une métrique n’est exposée que si une release courante la déclare.
- `grid_ids` référence `grids`. Une même configuration de release doit déclarer la métrique et la grille pour les associer.
- Le digest du manifeste reste `null` dans la réponse s’il est absent ou mal formé.
- Les gates de publication vérifient les prérequis scientifiques et la compatibilité des déclarations ; les clés JSON ne remplacent pas cette validation.
- Les configurations brutes, chemins privés et URLs de stockage ne sont pas publics.

### Partitions et inventaire

Clés utilisées dans `data_partitions.support_spec` :

```json
{
  "source_ids": ["modis_terra_c61_standard"],
  "start": "2024-01-17T00:00:00Z",
  "end_exclusive": "2024-01-18T00:00:00Z"
}
```

Les identifiants et bornes décrivent le contenu réel. Les dates sont UTC et l’intervalle est semi-ouvert. Les membres exacts sont enregistrés dans `release_partitions` et `release_assets`.

Le catalogue expose les intervalles des partitions validées sélectionnées par les aliases du scope. Sans bornes documentées, il ne déduit pas d’intervalle. Les périodes disjointes restent séparées. `serving_complete` décrit la complétude dans les tables de service, pas l’observabilité satellite ou la couverture nuageuse.

### Disponibilité fournisseur

`ingestion_subscriptions` relie les feeds aux scopes ; `feed_sources` identifie les sources émises. Le catalogue lit la dernière entrée de `source_availability` par feed vérifié : `verified_at` renseigné et état différent de `unverified`.

La disponibilité fournisseur et l’inventaire local sont séparés. Une date disponible chez NASA ne prouve pas qu’elle a été ingérée. Les inconnues restent `null` ou `unknown`.

### Historique et pagination

Les anciennes releases publiées restent consultables par UUID. Déplacer un alias ne modifie pas les analyses déjà associées à une version. `parent_release_id` et `release_changes` permettent de retrouver les changements intermédiaires.

`/updates` compare des UUIDs ; `revision_records` compte les entrées du journal, pas des incidents ou des partitions uniques. Le filtre `alias` permet de suivre un flux précis. Une baseline hors de l’ascendance courante donne `history_complete=false` et `BASELINE_NOT_ANCESTOR`.

Les membres de release sont paginés avec `membership=partitions|assets`, `limit` de 1 à 100 et un curseur signé lié à la release, au type de membres et à la taille de page. Les réplicas partagent `CURSOR_SECRET` ; une rotation invalide les anciens curseurs.

Les grands compteurs sont des chaînes décimales. Les sources normalisées sont marquées `record` et celles des fichiers d’entrée `input`.

## Intégration du socle et des Sources

L’API utilise Fastify 5 pour toutes les routes, y compris les ressources encore en `501`. Les plugins CORS, sécurité, compression et formulaires sont natifs Fastify. Swagger est généré depuis les schémas des routes : l’interface est disponible à `/api-docs/` et le document OpenAPI à `/api-docs/json`.

La logique Sources de `main` est adaptée à Fastify et conserve Prisma. Les lectures de phase 1 conservent leurs requêtes SQL paramétrées. `sources-cursor.ts` gère les curseurs Sources avec `PAGINATION_SECRET`, tandis que `cursor.ts` gère les membres de release avec `CURSOR_SECRET`.

La readiness vérifie PostgreSQL et Redis, puis le catalogue via un provider propre à l’application. Une base connectée ne suffit pas à déclarer l’API prête si aucune release n’est servable. Créer une source ne publie pas de release et ne remplace pas l’ingestion.

L’idempotence des créations de sources utilise les hooks Fastify et conserve les stores Redis et mémoire du socle. Les tests de phase 0 et de phase 1 sont exécutés ensemble. La file de jobs durable, l’authentification métier et l’harmonisation restent hors de cette livraison.

Le cache d’idempotence conserve la réponse applicative avant compression. Chaque rejeu négocie sa propre compression et recalcule sa longueur ; les anciens en-têtes `Content-Encoding` et `Content-Length` ne sont pas rejoués. Le `request_id` correspond toujours à la requête courante. Les tests couvrent les rejeux gzip et les changements d’encodage entre deux appels.

## Validation et limites

Les tests rapides appliquent la chaîne des migrations dans PostgreSQL embarqué et utilisent des fixtures isolées. Les types géométriques y sont adaptés. La suite `test:postgres` vérifie séparément les endpoints, les types PostGIS, les contraintes SQL et la readiness PostgreSQL/Redis sur les services Docker. Elle est limitée à la base `firebridge_phase1_test` et au scope `phase1_test` pour ses données fictives ; aucun téléchargement NASA n’est effectué. Les commandes sont dans le [README](../README.md).

Avant l’intégration finale :

1. Appliquer les migrations sur une base de développement et exécuter `test:postgres` sur la base dédiée.
2. Faire publier par l’ingestion un petit jeu réel avec ses métadonnées, sans réutiliser le scope de test.
3. Rejouer les endpoints via `http://localhost:3000/api-docs/`.
4. Comparer les réponses à l’inventaire et aux versions publiés.
5. Vérifier qu’une nouvelle publication change les aliases sans modifier les anciennes releases.

Les autres ressources restent des squelettes `501`. Les guides personnels et la démo manuelle restent exclus des fichiers partagés.
