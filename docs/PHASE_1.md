# Phase 1 ? Catalogue et versions : contrat d?int?gration

Ce document d?crit les conventions n?cessaires pour raccorder les endpoints ? la publication des donn?es. Les param?tres HTTP et r?ponses d?taill?es sont document?s dans [API.md](../API.md) ; le d?marrage et les commandes de validation sont dans le [README](../README.md).

## P?rim?tre livr?

| Endpoint                            | Responsabilit?                                           |
| ----------------------------------- | -------------------------------------------------------- |
| `GET /api/v1/catalog`               | Sources, m?triques et releases courantes d?un scope      |
| `GET /api/v1/releases/{release_id}` | M?tadonn?es et membres pagin?s d?une release publi?e     |
| `GET /api/v1/updates`               | Comparaison des aliases courants avec une release connue |

Les trois routes lisent PostgreSQL dans une transaction `REPEATABLE READ READ ONLY`. Elles ne d?clenchent ni acquisition fournisseur, ni publication de release, ni migration.

Les lectures utilisent le sch?ma `firebridge`, d?crit dans [le SQL de conception](../packages/database/prisma/sql/firebridge_schema_v2.sql). Les migrations officielles doivent ?tre raccord?es et valid?es par l??quipe ; ce fichier SQL ne constitue pas un historique de migrations appliqu?es.

## Contrat ? respecter c?t? ingestion

### M?tadonn?es de release

Les lignes de `data_releases` servies par ces routes doivent avoir `status=published` et une date `published_at`. Les aliases doivent cibler une release du m?me `scope_key`. La publication des membres et le d?placement de l?alias doivent ?tre atomiques.

Les cl?s JSON suivantes de `data_releases.config` d?crivent les capacit?s publi?es :

```json
{
  "metric_ids": ["native_detections_v1"],
  "grid_ids": [],
  "manifest_sha256": "empreinte SHA-256 r?elle du manifeste, 64 caract?res hexad?cimaux"
}
```

Ce JSON illustre la structure attendue ; la valeur descriptive du digest doit ?tre remplac?e par une empreinte r?elle.

- `metric_ids` r?f?rence `metric_definitions`. Une m?trique n?est expos?e que si une release courante la d?clare.
- `grid_ids` r?f?rence `grids`. Une grille est associ?e ? une m?trique uniquement si une m?me configuration de release d?clare les deux.
- `manifest_sha256` contient le digest du manifeste. Si la valeur est absente ou mal form?e, l?API renvoie `manifest_digest=null`.
- Les gates de publication doivent v?rifier les pr?requis scientifiques, les versions et la compatibilit? des m?triques et grilles d?clar?es. Leur pr?sence dans la configuration ne remplace pas cette validation.
- Les configurations brutes, chemins priv?s et URLs de stockage ne sont pas publics.

### M?tadonn?es de partition

Les cl?s utilis?es dans `data_partitions.support_spec` sont :

```json
{
  "source_ids": ["modis_terra_c61_standard"],
  "start": "2024-01-17T00:00:00Z",
  "end_exclusive": "2024-01-18T00:00:00Z"
}
```

Ces identifiants et bornes doivent d?crire le contenu r?el de la partition. Les dates sont UTC et l?intervalle est semi-ouvert. Les associations exactes ? une release sont enregistr?es dans `release_partitions` et `release_assets`.

Le catalogue expose les intervalles des partitions valid?es s?lectionn?es par les aliases du scope. Sans bornes document?es, il ne d?duit pas d?intervalle. Les intervalles disjoints restent s?par?s. `serving_complete` indique la compl?tude dans les tables de service, pas la visibilit? satellite ou la couverture nuageuse.

### Disponibilit? fournisseur

`ingestion_subscriptions` relie les feeds aux scopes ; `feed_sources` identifie les sources ?mises. Le catalogue lit la derni?re entr?e de `source_availability` par feed v?rifi?, avec `ingestion_feeds.verified_at` renseign? et un ?tat diff?rent de `unverified`.

La disponibilit? fournisseur et l?inventaire local sont s?par?s. Une date disponible chez le fournisseur ne prouve pas qu?elle a ?t? ing?r?e. Les donn?es inconnues restent `null` ou `unknown`.

### Historique et reproductibilit?

Les anciennes releases publi?es restent consultables par leur UUID. Le d?placement d?un alias ne modifie pas les analyses d?j? associ?es ? une version.

`parent_release_id` et `release_changes` permettent de retrouver les changements interm?diaires. Le polling de `/updates` compare des UUIDs. Ses r?sum?s regroupent les entr?es du journal par raison ; `revision_records` ne compte pas des incidents ou des partitions uniques.

Pour suivre un flux particulier, le client doit renseigner le filtre `alias`. Une baseline en dehors de l?ascendance courante produit `history_complete=false` et l?avertissement `BASELINE_NOT_ANCESTOR`.

## Pagination et configuration

Les d?tails de release utilisent `membership=partitions|assets`, `limit` de 1 ? 100 et un curseur sign? li? ? la release, au type de membres et ? la taille de page. Les r?plicas API doivent partager `CURSOR_SECRET`. Une rotation invalide les anciens curseurs.

Les compteurs susceptibles de d?passer la pr?cision des nombres JavaScript sont des cha?nes d?cimales. Les sources normalis?es sont marqu?es `record` et les sources des fichiers d?entr?e `input`.

## Validation et limites de livraison

Les tests de `apps/api/tests/app.test.ts` ex?cutent les requ?tes SQL dans PostgreSQL embarqu?, avec les fixtures isol?es de `apps/api/tests/helpers/database.ts`. Ils couvrent les contrats HTTP, la pagination, les valeurs inconnues, les releases publi?es, les changements et la lecture seule.

Ces tests adaptent les types g?om?triques pour les lectures de m?tadonn?es. Ils ne valident ni PostGIS r?el, ni les migrations de l??quipe, ni une ingestion NASA.

Avant l?int?gration finale :

1. Appliquer les migrations m?tier dans une base de d?veloppement.
2. Publier un petit jeu r?el et ses m?tadonn?es conform?ment au contrat ci-dessus.
3. Rejouer les trois endpoints via `http://localhost:3000/api-docs/`.
4. Comparer les r?ponses ? l?inventaire et aux versions r?ellement publi?s.
5. V?rifier qu?une nouvelle publication change les aliases sans modifier les anciennes releases.

Aucune authentification m?tier, ingestion ou harmonisation scientifique n?est livr?e par ces trois routes. Les autres ressources restent des squelettes `501`. Les guides personnels et la d?mo manuelle ne font pas partie des fichiers partag?s.
