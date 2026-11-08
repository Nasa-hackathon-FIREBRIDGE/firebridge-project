# Phase 6 — contexte et explications

Cette phase ajoute sept opérations sous `/api/v1`. Toutes lisent l’analyse sauvegardée, sa zone, ses dates et ses releases fixes. Elles ne suivent pas les alias `latest_*` après la création de l’analyse. Aucune requête HTTP ne lance de téléchargement, d’entraînement ou de calcul de masques.

| Opération                            | Rôle                                                                                                | Paramètres principaux                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /analyses/{id}/coverage`        | Couverture préparée des observations ; inconnue pour les simples points                             | `start_date`, `end_date_exclusive`, `cell_id`                                               |
| `GET /analyses/{id}/cells/{cell_id}` | Observations, QA, jours sélectionnés, références aux assets et prédictions approuvées d’une cellule | Dates, `limit`, `cursor`                                                                    |
| `GET /analyses/{id}/comparison`      | Comptages natifs séparés ou expérience scientifique déjà validée                                    | `view=native_counts\|common_response\|withheld_reference`, `resolution=week\|month`         |
| `GET /analyses/{id}/weather`         | Météo historique/récente liée aux releases de l’analyse                                             | `context=historical\|recent\|both`, `resolution=hour\|day\|period`, `variables`, pagination |
| `GET /analyses/{id}/reports`         | Documents et affirmations collectées, avec leur incertitude                                         | `relation`, `review_status`, pagination                                                     |
| `POST /analyses/{id}/explanations`   | Figer les faits et créer un job d’explication                                                       | JSON `{ "language": "fr", "question": "" }`, `Idempotency-Key` facultatif                   |
| `GET /explanations/{id}`             | Lire l’état et le résultat vérifié d’une explication                                                | Aucun                                                                                       |

Les listes ont une limite de 50 par défaut, comprise entre 1 et 100. Les curseurs signés sont liés à l’analyse, aux releases, aux filtres, à la limite et à l’acteur. Les dates peuvent seulement réduire la fenêtre sauvegardée. Les réponses de ces routes portent `Cache-Control: private, no-store`.

## Disponibilité et limites

- `missing` : aucun contexte sélectionné ou aucune série correspondante ; ce n’est pas une valeur zéro.
- `unsupported` : les prérequis scientifiques ne permettent pas de produire ce résultat.
- `unavailable` : les enregistrements préparés ne satisfont pas les contrôles de cohérence.
- `partial` : données explicitement incomplètes ; les valeurs météo manquantes restent `null`.
- `ready` : données préparées disponibles dans le périmètre déclaré, sans garantie de recensement exhaustif des incendies.

Une release de points MODIS/VIIRS ne suffit pas à calculer une couverture d’observation. Le chemin natif garde donc une fraction `null` et un statut `unknown`. Les surfaces cloud/invalid/unobserved uniques restent `null` : le calcul de l’union des supports des passages n’est pas implémenté. `coverage?cell_id=...` annonce explicitement que l’agrégat par cellule n’est pas préparé ; utiliser `/cells/{cell_id}` pour les preuves. La complétude de l’ingestion reste distincte de l’observabilité.

Le chemin scientifique nécessite une grille, des poids de zone, des observations et agrégats préparés. La création d’analyses de phase 2 reste actuellement centrée sur le mode natif ; les analyses scientifiques sont un contrat de lecture pour le pipeline à venir. Cette livraison ne constitue donc pas une chaîne scientifique complète.

## Contrats de publication des données préparées

Ces contrats sont des interfaces internes pour les futurs producteurs. L’API vérifie les enregistrements SQL et les attestations de publication ; elle ne décode pas les fichiers masques et ne réalise pas elle-même une validation scientifique indépendante.

### Météo et rapports

Les composants `weather_historical`, `weather_recent` et `reports` doivent référencer des releases publiées, du bon type et du même scope que le satellite. Les partitions membres doivent être validées, `serving_complete=true`, et définir dans `support_spec` :

```json
{ "weather_value_ids": ["1001", "1002"] }
```

ou :

```json
{ "reported_event_ids": ["60000000-0000-4000-8000-000000000041"] }
```

`row_count` doit correspondre au nombre d’identifiants distincts. Les enregistrements doivent exister et leurs assets acceptés doivent appartenir à la release. Une partition absente, non validée ou incohérente ne permet pas de déclarer le contexte disponible. Limites : 1 000 partitions pertinentes et 10 000 membres distincts par release.

La météo horaire conserve les positions/supports natifs, se limite aux intervalles d’au plus une heure et recoupe la zone et les dates. Elle est étiquetée `native_location`, sans prétendre représenter une moyenne de toute la zone. Les réanalyses/stations appartiennent au contexte historique ; les prévisions/modèles courants au contexte récent. La date d’émission est préservée.

Les séries journalières et de période proviennent uniquement de `weather_summaries` pour cette analyse. Leur `input_manifest_uri` interne doit valoir `urn:firebridge:weather-inputs-v1:` suivi de `evidenceHash` du JSON suivant :

```json
{
  "analysis_id": "UUID",
  "component": "weather_historical",
  "release_id": "UUID",
  "weather_value_ids": ["identifiants distincts triés comme chaînes"],
  "area_id": "UUID",
  "weighting_version": "v1",
  "start_date": "2024-01-17",
  "end_date_exclusive": "2024-01-20"
}
```

La source de la synthèse doit figurer parmi ces entrées. Les résumés utilisent `area_weighted` ou `point_sample` ; l’API ne fabrique pas d’agrégation à partir d’unités ou de supports incompatibles. Les méthodes, fractions de couverture et citations sont retournées ; les chemins de stockage sont retirés.

Les rapports sont limités aux événements membres ayant un lien avec l’analyse et des dates compatibles. Si plusieurs versions de rapprochement existent, la plus récemment revue, puis la version de méthode décroissante, est retenue. La relation `candidate` reste une hypothèse, la précision géographique est conservée et aucun centroïde d’incendie n’est inventé. Les URL publiques perdent paramètres et fragments ; les adresses privées évidentes sont écartées. Les documents ne sont pas un inventaire exhaustif d’incidents.

### Couverture, cellules et comparaison scientifique

`data_releases.config.scientific_serving_v1` doit contenir :

```json
{
  "publication_gates_passed": true,
  "mask_inventory_verified": true,
  "metric_key": "métrique enregistrée",
  "grid_id": "grille enregistrée",
  "time_basis": "utc",
  "selection_policy": "standard",
  "weighting_version": "v1",
  "support_definition_sha256": "empreinte SHA-256 de 64 caractères hexadécimaux",
  "qa_policy_version": "version de QA",
  "source_ids": ["sources exactes de la demande sauvegardée"],
  "model_ids": []
}
```

Ces valeurs doivent correspondre à l’analyse ; les modèles déclarés doivent être `validated`. Une métrique qui nécessite un modèle ne peut pas utiliser une liste vide. Le masque terrestre de la grille doit être accepté. Pour les jours observés/estimés, l’API exige des observations éligibles avec la bonne QA, des compagnons `fire_mask` et `geolocation` acceptés et, si nécessaire, une prédiction supportée d’un modèle approuvé.

La couverture utilise le `calendar_periods` de résolution `selection` correspondant exactement à la fenêtre et vérifie son dénominateur contre les poids de zone et le nombre de jours. Elle contrôle les statuts des cellules-jours et leur nombre attendu. La limite `MAX_EVIDENCE_CELL_DAYS` protège les lectures. Une fenêtre réduite nécessite son propre agrégat préparé ; aucun agrégat incompatible n’est réutilisé.

Une comparaison scientifique nécessite aussi `analyses.request_spec.comparison_experiment_id` et une évaluation de cette release, pour un modèle approuvé. `evaluations.metrics.public_comparison_v1` doit définir la zone, la fenêtre, la résolution, la vue, le même `support_definition_sha256`, `publication_gates_passed=true`, `unit=dimensionless_reference_response` et `series[{source_id,values[{start,end_exclusive,value}]}]`. Les valeurs sont comprises entre 0 et 1 ou `null`. La vue `withheld_reference` exige également `held_out_verified=true` et des blocs indépendants. La qualité de l’expérience et sa publication restent la responsabilité du pipeline scientifique.

## Explications et worker

L’API fige dans une transaction cohérente les comptages natifs de phase 3, leur statut (`complete`, `lower_bound`, `unknown`), leurs citations et limites. Elle crée atomiquement `evidence_snapshots`, `ai_explanations`, `api_jobs`, la clé durable et l’événement `explanation.requested`. Le job est envoyé par l’outbox à BullMQ, puis exécuté par le worker.

Le mode fourni est **un modèle de texte déterministe**, sans appel à un fournisseur d’IA externe. Son état final est `template_fallback`. Il ne répond pas aux questions libres : celles-ci sont conservées avec la limite `FREEFORM_QUESTION_NOT_ANSWERED_BY_TEMPLATE`. Il ne déduit ni causalité, ni prévision, ni nombre d’incidents uniques. La météo, les rapports et les résultats scientifiques ne sont pas encore intégrés dans ce résumé factuel natif.

Le worker vérifie structure, empreinte, nombres et citations. Une preuve altérée donne `EVIDENCE_VALIDATION_FAILED`, sans sortie et sans retry automatique. Une erreur technique reste relançable ; BullMQ prévoit trois tentatives. La lecture revalide l’empreinte du snapshot et le résultat déterministe avant de l’exposer.

Une même clé rejoue le résultat initial ; une même clé avec une autre demande répond `409`. Le cache inclut les faits figés, la langue, la question, l’acteur et la version du modèle de texte. Un nouvel alias d’idempotence peut désigner le même job sans en créer un autre. Une nouvelle version des faits produit une autre identité de cache. Le GET est limité à l’acteur créateur selon le résolveur existant ; **en l’absence de fournisseur d’identité, les requêtes anonymes partagent l’acteur `unauthenticated`**. Cette règle ne remplace pas une authentification de production.

La sixième migration, `20261101020000_explanation_request_keys`, ajoute le registre durable des clés d’explication sans réécrire les migrations précédentes. Appliquer les migrations avant de démarrer l’API et le worker :

```powershell
npm.cmd run prisma:deploy --workspace @firebridge/database
npm.cmd run dev:api
# Dans un autre terminal, avec les mêmes DATABASE_URL et REDIS_URL :
npm.cmd run dev:worker
```

## Test manuel et automatisé

Les fixtures sont fictives et refusent toute base autre que `firebridge_phase1_test`. **Leur initialisation réinitialise les données de cette base de test** ; arrêter les consommateurs de jobs de test avant de l’exécuter.

```powershell
$env:PHASE1_TEST_DATABASE_URL='postgresql://firebridge:firebridge@localhost:5432/firebridge_phase1_test'
$env:PHASE1_TEST_REDIS_URL='redis://localhost:16379'
$env:DATABASE_URL=$env:PHASE1_TEST_DATABASE_URL
$env:REDIS_URL=$env:PHASE1_TEST_REDIS_URL
$env:DEFAULT_SCOPE_KEY='phase1_test'
npm.cmd run prisma:deploy --workspace @firebridge/database
npm.cmd run fixtures:phase6 --workspace @firebridge/api
npm.cmd run dev:api
```

Dans Swagger `/api-docs`, utiliser l’analyse native `a3000000-0000-4000-8000-000000000001` pour la météo, les rapports, les comparaisons de comptages et les explications. Pour la couverture/cellule préparée, utiliser `60000000-0000-4000-8000-000000000100` et la cellule `6001`. La comparaison scientifique fictive utilise `view=common_response&resolution=month`. Pour les explications, POST `{ "language": "fr" }`, démarrer le worker dans un autre terminal, puis lire `GET /explanations/{explanation_id}`.

```powershell
npm.cmd test
npm.cmd run test:postgres --workspace @firebridge/api
# Exécuter ensuite, pas en parallèle : les suites réinitialisent la même base dédiée.
npm.cmd run test:postgres --workspace @firebridge/worker
npm.cmd run lint
npm.cmd run build
```

Les tests couvrent les chemins préparés, l’absence de prérequis, les versions figées, la sélection géographique et temporelle, le fuseau UTC, la pagination, la provenance publique, les clés concurrentes, les preuves altérées et la reprise après erreur de stockage. Ils ne valident pas de vrais produits NASA ni la qualité d’un modèle scientifique.

Validation locale de cette livraison : 194 tests API rapides, 1 test worker rapide, 79 tests API PostgreSQL et 14 tests worker PostgreSQL, soit 288 tests au total, dont 28 ajoutés pour la phase 6. Les suites et tests ciblés ont été exécutés séparément sur la même base dédiée. Compilation, ESLint, validation Prisma et comparaison du schéma avec la base de test passent. Un contrôle HTTP sur le serveur compilé a vérifié les sept opérations Swagger, les lectures préparées, le POST d’explication, son traitement et le GET final, ainsi que le rejeu de sa clé. Cette validation ne couvre pas la branche phase 4 du collègue, qui reste séparée.
