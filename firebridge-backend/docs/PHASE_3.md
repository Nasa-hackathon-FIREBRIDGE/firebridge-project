# Phase 3 : résultats natifs d’une analyse

La phase 3 ajoute quatre lectures sous `/api/v1/analyses/{id}` :

| Route             | Résultat                                             |
| ----------------- | ---------------------------------------------------- |
| `GET /detections` | Features GeoJSON, clipping exact, pagination signée  |
| `GET /summary`    | Comptages distincts par source et limites explicites |
| `GET /calendar`   | Comptages UTC par jour, semaine ou mois              |
| `GET /provenance` | Entrées des releases épinglées, hashes et citations  |

Les routes complètes sont documentées dans Swagger. Les résultats utilisent l’enveloppe commune et les compteurs sont des chaînes décimales. Un point chaud reste une détection : aucun total d’incidents uniques ni surface brûlée n’est déduit.

## Dépendance à la phase 2 et migrations

La branche `zakaria/fastify-phase-2` apporte les zones, les analyses, les jobs et le worker/outbox. Elle a été intégrée à la branche de travail de phase 3 en conservant la phase 1.

La phase 2 proposait une migration consolidée pour une base vide et supprimait les deux premières migrations. Cette consolidation est remplacée ici par `20261101000000_phase2_native_serving`, qui ajoute seulement les 31 tables manquantes du schéma v2 et leurs index. Les trois migrations précédentes sont préservées. Certaines tables sont destinées aux phases suivantes : leur existence ne signifie pas que ces fonctionnalités sont implémentées.

Pour une base créée avec notre historique partagé : `npm run prisma:deploy --workspace @firebridge/database`. Aucun seed ni effacement de données n’est effectué par les migrations.

La cinquième migration, `20261101010000_analysis_request_keys`, ajoute seulement le registre des clés de requête décrit ci-dessous. Elle conserve l’historique existant et n’efface aucune analyse.

**Une base initialisée avec la migration consolidée de la branche phase 2 possède un historique différent.** Ne pas appliquer la chaîne additive par-dessus. Pour le développement, créer une nouvelle base avec l’historique commun, ou préparer une reprise de baseline après revue des données. Aucun reset ou changement manuel de `_prisma_migrations` n’est effectué automatiquement.

## Création et réutilisation des analyses

La création sélectionne les versions satellite, météo et rapports dans la transaction avant de calculer la clé de cache. Cette clé inclut les UUIDs sélectionnés (ou `null` pour les composants absents), les paramètres normalisés, les politiques baseline/météo/rapports et l’identité fournie par le serveur. L’ordre des clés d’un objet JSON ne change pas son empreinte. La recherche d’une analyse réutilisable se fait dans le même snapshot `REPEATABLE READ`. Les contraintes d’unicité et les reprises de transaction gèrent les créations concurrentes.

Une nouvelle version des données peut produire une nouvelle analyse, sans modifier l’ancienne. À l’inverse, un `Idempotency-Key` explicite désigne le rejeu d’une demande précise : même clé et même demande renvoient son résultat d’origine, même après une publication. Utiliser une nouvelle clé, ou omettre cet en-tête facultatif, pour une nouvelle demande avec les versions alors sélectionnées. Modifier la demande sous la même clé renvoie `409`.

Le registre `analysis_request_keys` permet à plusieurs clés de requête de retrouver un même job réutilisé, sans lancer de travail supplémentaire. Les anciennes analyses restent accessibles par leur ID. Leurs clés de cache antérieures ne sont pas réécrites : une demande sans clé peut créer une nouvelle analyse une fois après la mise à jour. Les anciens jobs conservent leur comportement de rejeu explicite grâce à leur clé et leur demande enregistrées.

Cette correction porte sur l’identité du cache et le rejeu des demandes. Elle ne remplace pas la politique existante de résolution des releases par un nouveau contrat scope/alias et n’ajoute pas de publication NASA.

## Lecture reproductible

Chaque requête ouvre une transaction `REPEATABLE READ READ ONLY`. Elle utilise `analyses.release_id` et les composants enregistrés, sans résoudre à nouveau les aliases. Le composant satellite doit pointer vers la même release publiée. Une indisponibilité météo ou rapports ne fabrique aucun zéro.

Les détections passent par `release_partitions → partition_detections → detections`. La sélection utilise `EXISTS` pour compter une seule fois un identifiant canonique présent dans plusieurs partitions. Les points sont filtrés par zone enregistrée, intervalle semi-ouvert, sources et niveau de traitement. Les anciennes zones traversant ±180° sont enveloppées lors de la lecture ; les trous restent exclus. Le clipping conserve l’index spatial sur les points.

Le résultat peut être lu directement lorsque la tranche SQL est complète. Le worker de phase 2 gère actuellement le cycle de vie et les composants ; il ne charge pas d’archives ni ne calcule de modèle. Les pourcentages fictifs ont été retirés de ce cycle de vie. Une tranche SQL incomplète retourne `409 SERVING_NOT_READY` pour les points ; aucun job de préparation de gros résultats n’est créé par un GET.

## Filtres et limites

- Détections : `limit` de 1 à 5 000, défaut 500 (borné aussi par `MAX_POINTS_PER_PAGE`), `cursor`, `source_ids` séparés par virgules, `start`, `end_exclusive`, `bbox=west,south,east,north`.
- Les sources doivent être un sous-ensemble de la sélection enregistrée. Pour les analyses de phase 2 sans `source_ids`, la sélection est l’ensemble des sources déclarées par les partitions de la release épinglée.
- Les timestamps de filtre sont UTC, terminés par `Z`, avec au plus trois décimales. La pagination conserve les six décimales des acquisitions PostgreSQL et les IDs bigint sous forme de chaînes.
- Le bbox est intersecté avec la zone enregistrée et doit avoir `west < east`. Les bbox traversant l’antiméridien doivent être scindés ; une zone sauvegardée traversant l’antiméridien est prise en charge.
- Calendrier : `resolution=day|week|month`, `start_date`, `end_date_exclusive`, dans la sélection enregistrée. Les semaines commencent le lundi ; les bords sont coupés aux dates demandées.
- Provenance : `limit` de 1 à 100, `cursor`, `asset_id`. Les filtres fact/cell ne sont pas implémentés.
- Maximum : 100 sources, 10 000 partitions et 3 660 périodes. Les lectures restent soumises au timeout SQL ; aucun échantillon tronqué n’est présenté comme un résultat complet.

Les premiers résultats prennent en charge `native_detections_v1` en UTC, en mode `standard_only` ou `nrt_only`. Les modes mixtes `best_available`, les métriques harmonisées et les politiques de confiance/QA non prises en charge donnent un résultat `unsupported`, sans conversion silencieuse. Aucun filtre scientifique inconnu n’est accepté dans l’URL.

## Zéro et inconnu

`serving_complete=true` signifie que les lignes de la partition sont en base ; cela ne prouve pas que l’inventaire fournisseur est complet. La lecture vérifie aussi le nombre de membres et la validation de la partition.

Pour affirmer un comptage complet, la publication doit vérifier et enregistrer dans `data_partitions.support_spec` :

```json
{
  "source_ids": ["modis_terra_c61_standard"],
  "area_id": "UUID de la révision de zone réellement couverte",
  "start": "2024-01-17T00:00:00Z",
  "end_exclusive": "2024-01-18T00:00:00Z",
  "inventory_complete": true
}
```

Cet exemple est descriptif ; l’ingestion doit renseigner une véritable zone et vérifier la complétude avant de poser ce marqueur. Les intervalles doivent couvrir toute la période, sans trou, dans le flux sélectionné et avant le cutoff de la release. Une période future ou ouverte ne reçoit pas un zéro définitif.

Sans cette preuve, un comptage positif est identifié `lower_bound`. Un résultat sans point a `count=null`, avec un `observed_count` séparé quand les lignes sont consultables. Une période complète sans détection reçoit `count="0"`. La couverture d’observation, les métriques comparables et les résultats contextuels non calculés restent `null`.

## Pagination, provenance et cache

Les curseurs signés lient l’analyse, sa release, sa sélection, les filtres normalisés, la taille de page, l’endpoint et le contexte d’identité fourni par le serveur. Ce lien ne remplace pas une future authentification et politique d’accès.

Les réponses utilisent des ETags faibles : le résultat logique est stable, mais le `request_id` change. Les réponses conditionnelles peuvent être `304`. Les headers indiquent la release épinglée.

La provenance pagine les entrées des releases épinglées, y compris l’asset d’origine d’un enregistrement canonique réutilisé. Elle expose les identifiants, versions, hashes, dates et citations ; aucun `storage_uri`, `source_url`, token ou configuration brute n’est publié. Son périmètre est `pinned_release_inputs`, qui peut être plus large que le clipping d’un point.

## Vérification

`npm test` conserve les tests rapides indépendants de Docker. Les suites `test:postgres` API et worker utilisent uniquement `firebridge_phase1_test`, avec PostgreSQL/PostGIS et Redis réels. Les données restent synthétiques. Les tests couvrent également la création d’une analyse par la phase 2, les microsecondes, les grands IDs, les doublons, les trous, l’antiméridien, les inventaires inconnus et les changements d’alias.

Après ces tests, `npm run fixtures:phase3 --workspace @firebridge/api` recharge le jeu synthétique de phase 3 dans cette base dédiée et affiche un `analysis_id` stable. Cette commande exige `PHASE1_TEST_DATABASE_URL` et ne démarre aucun serveur. Le README décrit le lancement de l’API de test sur le port 3002.

Les exports, les tuiles, l’ingestion NASA, la préparation de grands résultats et l’harmonisation scientifique restent hors de la phase 3.
