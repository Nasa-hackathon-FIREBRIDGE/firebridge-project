# Vérification de la branche phase 4

Référence examinée : `origin/zakaria/fastify-phase-2`, commit `b760b7ff43cfa952ce6400b4e8d8aaee4716320c` (`feat: implement Phase 4 results and export pipeline`). La branche a été récupérée avec `git fetch`, sans fusion ni changement de ses fichiers.

## Présent dans le code

- `GET /api/v1/analyses/{id}/tiles/{layer}/{z}/{x}/{y}.mvt` : tuiles cartographiques.
- `POST /api/v1/analyses/{id}/exports` : demande d’export asynchrone.
- `GET /api/v1/jobs/{id}/download` : téléchargement du fichier produit.
- Nouveau package `@firebridge/results`, exports CSV/GeoJSON/Parquet, stockage local partagé, queue d’exports, rétention, contrôles de disponibilité du worker et tests.

## Points à réconcilier avant fusion

1. **Même sélection que la phase 3.** `packages/results/src/detections.repository.ts`, fonction `detectionSelection`, ne restreint pas les sources à `analyses.request_spec.source_ids` et impose `processing_level='standard'` au lieu d’appliquer le mode sauvegardé. Exemple : une analyse limitée à Terra pourrait exporter Aqua si la release contient les deux sources. Il faut réutiliser le contrat de sélection de phase 3 et permettre uniquement des filtres qui réduisent ce périmètre.
2. **Même version de satellite.** `findResultContext` utilise `COALESCE(c.release_id,a.release_id)` sans rejeter un composant satellite différent de `analyses.release_id`. Notre phase 3 refuse cette incohérence avec `409`. Carte, exports et lectures doivent partager ce contrôle.
3. **Pas de résultat partiel annoncé complet.** La sélection accepte les lignes appartenant à des partitions validées et complètes, mais ne vérifie pas que toutes les partitions pertinentes sont complètes ni que leurs `row_count` correspondent à leur appartenance SQL. Une partition non servable peut ainsi être omise silencieusement. La phase 3 possède ces contrôles ; les exports et tuiles doivent les partager.
4. **Base de branche plus ancienne.** Les phases 3/5 et la correction du cache ne sont pas dans cette branche. Préserver notre historique de migrations et intégrer séparément les index additionnels de phase 4. Réconcilier aussi les curseurs, l’identité, les paramètres, le dispatcher et les processeurs : conserver `analysis.requested`, `ingestion.plan.requested` et `explanation.requested` en ajoutant les exports.

## Niveau de vérification

Il s’agit d’une revue statique du commit récupéré ; ses tests n’ont pas été exécutés localement. Le fichier livré `docs/API_TEST_REPORT.md`, daté du 31 octobre, annonce des tests unitaires et d’intégration réussis, mais son audit HTTP final reste **BLOCKED** après l’échec de la préparation des exports (`0/0` cas HTTP exécutés). Ce rapport ne prouve donc pas un parcours HTTP complet. D’autres comptes rendus documentent des réparations ultérieures ; une validation fraîche après intégration reste nécessaire.

La phase 4 est bien poussée. Elle n’est pas encore fusionnée ni validée avec l’ensemble de nos phases.
