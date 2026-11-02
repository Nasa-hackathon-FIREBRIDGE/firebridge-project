# Phase 4 — revue et intégration

**État après intégration sur `feat/anwar-phase-6-context-evidence` : les trois points de sélection ci-dessous sont corrigés.** La phase 4 du commit `b760b7f` a été rapprochée des phases 3, 5 et 6. Ce document conserve les constats initiaux et décrit leur résolution.

## Corrections et validation de la fusion

- Les sources et le mode `standard_only` ou `nrt_only` viennent de la demande sauvegardée. Les règles de sélection des partitions, de QA prise en charge et de géométrie, y compris l’antiméridien, sont partagées avec la phase 3 dans `@firebridge/contracts`.
- Le composant satellite doit désigner exactement `analyses.release_id`. Une incohérence bloque la carte, la création d’export et son traitement.
- Toutes les partitions pertinentes doivent être validées, complètement servies et cohérentes avec leur nombre de membres SQL. Une partition manquante ou incohérente n’est plus omise silencieusement. Le contrôle est répété avant la lecture des tuiles et dans la transaction de génération des exports.
- Les migrations existantes sont conservées. Les index additionnels sont appliqués après `api_jobs`, dans `20261101030000_phase4_serving_indexes`.
- Le worker conserve `analysis.requested`, `ingestion.plan.requested` et `explanation.requested`, et ajoute `export.requested` dans une queue séparée. Les validations de payload et d’agrégat de l’outbox tiennent compte des quatre opérations.
- La fixture phase 4 est versionnée `phase4-rif-v2`. Les partitions incomplètes/quarantinées restent dans une release brouillon, et les appels Prisma du lanceur sont compatibles avec notre schéma. Elle n’écrit que dans une base de test explicitement choisie.

Validation : **285 tests API rapides + 87 tests worker rapides + 87 tests API PostgreSQL + 14 tests worker PostgreSQL + 23 tests de phase 4/fiabilité = 496 tests réussis**. Les tests ajoutés vérifient Terra seule, le mode NRT, les versions incohérentes, les partitions incomplètes, les alias déplacés et un export complet jusqu’au téléchargement. Les trois formats, la concurrence, les pannes de stockage et la reprise du worker sont testés sur PostgreSQL/PostGIS et Redis réels.

Compilation, typecheck, ESLint et comparaison Prisma passent. Les sept migrations ont été appliquées sur une base vide. Les données de validation sont fictives ; aucune donnée NASA n’a été téléchargée.

Le parcours HTTP a aussi été exécuté sur le serveur compilé avec le vrai dispatcher et les vrais workers : readiness `200`, tuile décodée contenant 256 détections, téléchargements CSV/GeoJSON/Parquet vérifiés ligne par ligne (256 lignes chacun), création HTTP d’un export jusqu’à son succès, puis explication de phase 6 jusqu’à `template_fallback` avec le comptage exact. Les preuves locales restent dans `.data/phase4-rif-v2/firebridge_merge_schema_test/http/`, hors Git.

Pour reproduire le parcours dans une base de test vierge ayant reçu les sept migrations : définir `TEST_DATABASE_URL` vers cette base `*_test` et `TEST_REDIS_URL` vers une base Redis dédiée 1–15, exécuter `npm.cmd run seed:phase4 -- --apply --confirm-database <nom>`, puis `npm.cmd run phase4:worker` et `npm.cmd run phase4:api` dans deux terminaux. Le lanceur API utilise le port 3104 par défaut, modifiable avec `PHASE4_TEST_PORT`. Le seed vérifie la cible et ne supprime aucune ligne. Ajouter `--queue-exports --export-run <étiquette>` pour générer les trois formats via le worker. Les anciennes fixtures v1 ne sont pas modifiées ; utiliser une base séparée pour v2.

Les rapports `API_AUDIT.md`, `API_TEST_REPORT.md`, `FIREBRIDGE_RELIABILITY_REPORT.md` et les guides historiques livrés avec la branche décrivent des exécutions antérieures. Certaines mentions d’authentification n’y correspondent plus au code actuel : l’API actuelle n’a pas de fournisseur d’identité. Le présent compte rendu décrit la fusion ; l’ancien audit ne constitue pas son résultat.

## Revue initiale avant fusion

Référence examinée : `origin/zakaria/fastify-phase-2`, commit `b760b7ff43cfa952ce6400b4e8d8aaee4716320c` (`feat: implement Phase 4 results and export pipeline`). La branche a été récupérée avec `git fetch`, sans fusion ni changement de ses fichiers.

## Présent dans le code

- `GET /api/v1/analyses/{id}/tiles/{layer}/{z}/{x}/{y}.mvt` : tuiles cartographiques.
- `POST /api/v1/analyses/{id}/exports` : demande d’export asynchrone.
- `GET /api/v1/jobs/{id}/download` : téléchargement du fichier produit.
- Nouveau package `@firebridge/results`, exports CSV/GeoJSON/Parquet, stockage local partagé, queue d’exports, rétention, contrôles de disponibilité du worker et tests.

## Constats initiaux, corrigés dans l’intégration

1. **Même sélection que la phase 3.** `packages/results/src/detections.repository.ts`, fonction `detectionSelection`, ne restreint pas les sources à `analyses.request_spec.source_ids` et impose `processing_level='standard'` au lieu d’appliquer le mode sauvegardé. Exemple : une analyse limitée à Terra pourrait exporter Aqua si la release contient les deux sources. Il faut réutiliser le contrat de sélection de phase 3 et permettre uniquement des filtres qui réduisent ce périmètre.
2. **Même version de satellite.** `findResultContext` utilise `COALESCE(c.release_id,a.release_id)` sans rejeter un composant satellite différent de `analyses.release_id`. Notre phase 3 refuse cette incohérence avec `409`. Carte, exports et lectures doivent partager ce contrôle.
3. **Pas de résultat partiel annoncé complet.** La sélection accepte les lignes appartenant à des partitions validées et complètes, mais ne vérifie pas que toutes les partitions pertinentes sont complètes ni que leurs `row_count` correspondent à leur appartenance SQL. Une partition non servable peut ainsi être omise silencieusement. La phase 3 possède ces contrôles ; les exports et tuiles doivent les partager.
4. **Base de branche plus ancienne.** Les phases 3/5 et la correction du cache ne sont pas dans cette branche. Préserver notre historique de migrations et intégrer séparément les index additionnels de phase 4. Réconcilier aussi les curseurs, l’identité, les paramètres, le dispatcher et les processeurs : conserver `analysis.requested`, `ingestion.plan.requested` et `explanation.requested` en ajoutant les exports.

## Niveau de vérification

Il s’agit d’une revue statique du commit récupéré ; ses tests n’ont pas été exécutés localement. Le fichier livré `docs/API_TEST_REPORT.md`, daté du 31 octobre, annonce des tests unitaires et d’intégration réussis, mais son audit HTTP final reste **BLOCKED** après l’échec de la préparation des exports (`0/0` cas HTTP exécutés). Ce rapport ne prouve donc pas un parcours HTTP complet. D’autres comptes rendus documentent des réparations ultérieures ; une validation fraîche après intégration reste nécessaire.

Cette conclusion concernait la revue initiale. La phase 4 est maintenant intégrée et testée avec les phases 3, 5 et 6, selon les résultats indiqués en tête de ce document.
