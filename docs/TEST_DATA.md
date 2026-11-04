# FIREBRIDGE — jeu de données de test de la base active

Date de chargement : 4 novembre 2026. Base ciblée : `firebridge`, dans le conteneur PostgreSQL/PostGIS existant `firebridge-postgres`.

## Statut et limites

Ce catalogue est un **jeu de test entièrement synthétique**. Les positions et horaires sont plausibles pour le Rif marocain, mais ils ne proviennent d'aucune observation satellitaire. Ils ne doivent servir ni à une analyse scientifique, ni à une démonstration présentée comme fondée sur des données NASA réelles.

Les identifiants de missions et de produits sont réels et servent uniquement de références de métadonnées : Terra/MODIS `MOD14` Collection 6.1, Aqua/MODIS `MYD14` Collection 6.1 et Suomi-NPP/VIIRS `VNP14IMG` Collection 2. Les notices officielles sont disponibles dans le [catalogue LAADS MOD14](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/MOD14), le [catalogue LAADS VNP14IMG](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP14IMG/) et le [guide MODIS Collection 6/6.1](https://www.earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf). Elles ne constituent pas la provenance des détections synthétiques.

L'archive FIRMS consultée exige une authentification Earthdata pour les téléchargements d'archives. Aucun jeton, compte ou mécanisme d'authentification n'a été introduit. Le chargement utilise donc des fichiers générés localement, dont la provenance interne porte explicitement les marqueurs suivants :

- `synthetic: true`
- `test_only: true`
- `not_for_scientific_use: true`
- `real_observation_coverage: false`
- `origin: FIREBRIDGE deterministic synthetic generator; NOT NASA observations`

Les champs scientifiques qui ne peuvent pas être justifiés (`frp`, confiance et luminosité) restent nuls ou vides. Aucune mesure scientifique n'a été inventée.

## Contenu chargé

| Élément | Valeur |
| --- | --- |
| Fixture | `synthetic-rif-v1` |
| Scope du catalogue | `morocco` |
| Alias | `synthetic_test_native_v1` |
| Release publiée | `e05d1994-28fd-5381-a693-ccc011552839` |
| Intervalle | 15 juillet 2024 00:00 UTC inclus au 18 juillet 2024 00:00 UTC exclu |
| Sources | 3 sources dont chaque identifiant commence par `SYNTHETIC_TEST_` |
| Partitions | 9 partitions journalières validées, trois par jour |
| Détections | 36 points synthétiques, quatre par source et par jour |
| Zone principale | `35ff8d4d-1432-58f6-a76d-4d3838f96957`, rectangle `[-6, 34.7, -4.5, 35.6]` |
| Sous-zone | `ba0861ce-40a1-5a6e-ab54-fdcfc59bdc6d`, rectangle `[-5.65, 35.05, -5.15, 35.35]` |

Les assets bruts, les manifests de partitions et le manifeste de release sont présents dans le volume d'exports déjà partagé par l'API et le worker, sous `/app/.data/exports/seed/synthetic-rif-v1`. Leur taille et leur SHA-256 sont enregistrés dans le catalogue.

L'alias n'est publié qu'après la validation de la release, de ses assets, de ses neuf partitions et de leurs 36 relations aux détections. Cette relation complète satisfait la condition réelle de readiness du résolveur : un alias du scope par défaut `morocco` doit pointer vers une release `published`.

## Parcours validé

Le chargement a utilisé uniquement les dix endpoints intégrés sous `/api/v1` et les mécanismes existants de l'API et du worker.

- `GET /health/ready` répond 200 avec PostgreSQL, Redis et le catalogue à `ready`.
- Deux analyses ont été créées puis réellement traitées par le worker : `7e6e9170-2c8d-4c14-9ce3-db5760017452` pour la zone principale et `ba1e9522-faa3-4335-9049-ad817f66ec51` pour la sous-zone.
- Leur statut final est `partial`, ce qui est attendu : aucun contexte météo ou rapport réel n'a été fabriqué pour rendre le résultat artificiellement complet.
- La tuile mondiale `z=0` de la couche `detections` a été décodée et contient les 36 points attendus.
- Les exports CSV, GeoJSON et Parquet ont été générés par le worker, téléchargés par les liens signés et contrôlés contre les tailles et SHA-256 conservés en base.
- Le Parquet a été relu intégralement : 36 lignes, toutes rattachées à une source explicitement préfixée `SYNTHETIC_TEST_`.

Jobs d'export disponibles jusqu'au 5 novembre 2026 vers 21:51 UTC :

| Format | Job | Taille | SHA-256 |
| --- | --- | ---: | --- |
| CSV | `61622410-0457-4a59-b6ea-f717dcf7751b` | 4 243 octets | `c8ff58e60689b5ed20d1d97fa258d6443e2cf60adc9dad2f308d9d247f68049e` |
| GeoJSON | `6dc3991a-9ef9-4182-8084-6aba77985d40` | 9 463 octets | `9c48e9158deb952262c6b95bcab69130320b8c3baa299fa0cd8324e15188f19f` |
| Parquet | `cddb93bb-7711-455e-a92d-00b4a4adf77c` | 6 740 octets | `4a5220f813172fc72dda66a3a187ef5350e71a20ebd67360b6a216ad31525a8a` |

Pour télécharger un export, appeler son `GET /api/v1/jobs/{id}` afin d'obtenir un nouveau `download_url` signé, valable cinq minutes, puis appeler ce lien. La durée du lien n'est pas la durée de conservation du fichier.

## Rejouer ou auditer le chargement

Depuis la racine du backend :

```powershell
node scripts/populate-existing.mjs
```

Le script refuse une base différente de `firebridge`, une URL distante, le mode production ou un scope par défaut différent de `morocco`. Il fonctionne avec des insertions additives, une transaction et `ON CONFLICT DO NOTHING`, puis compare intégralement chaque ligne réutilisée. Une seconde exécution vérifiée a produit zéro insertion et a réutilisé exactement les mêmes entités, analyses et exports.

Avant chaque exécution, il produit un dump PostgreSQL custom, compare son SHA-256 dans et hors du conteneur, puis contrôle son catalogue avec `pg_restore --list`. Les chemins et empreintes de la dernière sauvegarde figurent dans `.data/population/synthetic-rif-v1/results.json`.

Les artefacts de contrôle locaux se trouvent dans `.data/population/synthetic-rif-v1/`. Ce répertoire contient notamment les exports téléchargés et la tuile MVT. Le script vérifie enfin que toutes les empreintes de lignes antérieures sont encore présentes et que l'historique Prisma est strictement inchangé.

Ce chargement n'a créé aucune base, n'a supprimé aucune donnée et n'a modifié ni migration, ni endpoint, ni frontend, ni mécanisme d'identité.
