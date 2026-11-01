# Jeu de test FIREBRIDGE Phase 4 — audit et plan d'exécution

> Historique de préparation, avant l’autorisation d’exécution. La fixture a
> depuis été appliquée dans une base isolée lors de l’audit autorisé. Consulter
> [docs/TEST_FIXTURES.md](docs/TEST_FIXTURES.md) et le
> [rapport exécuté](docs/API_TEST_REPORT.md) pour l’état actuel et les commandes.

Le seed est **préparé, pas appliqué**. Aucune connexion à PostgreSQL, insertion,
modification du `.env`, migration ou suppression n'a été effectuée pour cette
préparation. Le lancement de l'aperçu n'importe aucun client de base.

## Dépendances vérifiées dans le code

L'audit porte sur `schema.prisma`, la migration SQL v2 et les services/API/worker
actuels. Le script vérifiera également le catalogue PostgreSQL réel **avant
insertion**, une fois son exécution autorisée : version 16, PostGIS 3.4,
colonnes nécessaires, FK, types/SRID géométriques et index GiST.

```mermaid
flowchart TD
  S[sources] --> A[assets]
  S --> D[detections Point 4326]
  A --> D
  R[data_releases] --> P[pipeline_runs]
  P --> DP[data_partitions]
  DP --> PD[partition_detections]
  D --> PD
  R --> RP[release_partitions]
  DP --> RP
  R --> RA[release_assets]
  A --> RA
  AR[areas MultiPolygon 4326] --> AN[analyses]
  R --> AN
  M[metric_definitions] --> AN
  AN --> C[analysis_components]
  R --> C
  AN --> J[api_jobs analysis/export]
  J -. identifiants dans payload .-> O[outbox_events]
  O --> W[BullMQ et workers]
  W --> F[fichier export et métadonnées du job]
```

La relation outbox/job est logique dans le payload ; **aucune FK n'existe**
entre ces deux tables. Le lien entre analyse et détections n'est pas une
colonne `detections.analysis_id` : il traverse le composant satellite, la
release et les partitions, avec filtre spatial et temporel.

Le modèle Prisma déclare aussi la relation `analyses.metric_key` vers
`metric_definitions.id`. Le SQL v2 examiné ne l'exprime pas explicitement dans
`CREATE TABLE analyses` : le catalogue réel sera consigné sans inventer ni
ajouter une contrainte. Le service d'analyse assure déjà la définition requise.

| Table | Données obligatoires et contraintes pertinentes |
| --- | --- |
| `sources` | id texte, nom, fournisseur, kind autorisé, produit, collection, stream, URL, citation, licence, version |
| `areas` | id UUID, version, nom, MultiPolygon valide non vide 4326, hash géométrique, fuseau, provenance ; unique hash/version |
| `data_releases` | UUID, nom unique, statut, stream, version/config/hash, manifest, dataset_kind, scope, observation_cutoff |
| `assets` | UUID, FK source, clé native/révision, URL/URI, SHA-256 hex de 64 caractères, taille positive ou nulle, date de récupération, validation ; identités uniques |
| `pipeline_runs` | UUID, FK release, étape, clé d'idempotence unique, statut, version, config, manifeste d'entrée |
| `data_partitions` | UUID, FK run, kind, series_key, partition_key, support, URI/hash, manifeste d'entrée, version, row_count non négatif, serving_complete, validation |
| `detections` | bigint GENERATED ALWAYS, FK asset/source, clé native et hash uniques, méthode d'identité, niveau, acquired_at, Point 4326, schéma de confiance ; FRP fini non négatif |
| `partition_detections` | PK composée partition/détection et deux FK |
| `release_partitions` | FK release et FK composée partition/series_key/partition_key ; les trois valeurs doivent correspondre |
| `analyses` | FK area/release, dates ordonnées, métrique, base temporelle, politiques, request_spec, cache_key unique, statut |
| `analysis_components` | PK analyse/composant ; une release est obligatoire pour ready/partial |
| `api_jobs` | type, demandeur, hash, clé d'idempotence, request_spec et état ; unique demandeur/clé |
| `outbox_events` | UUID, type, aggregate_id texte, dedupe_key unique, payload, état, available_at |

## Minimum et scénario enrichi retenu

Le strict minimum serait une source, une area, une release, un asset, un run,
une partition validée et servable, une détection, leurs rattachements, puis une
analyse/composant/job/outbox créés par l'application. Pour tester correctement
les exclusions et l'agrégation, la fixture ajoute :

| Objet | Quantité / comportement |
| --- | --- |
| Source | 1, clairement marquée synthétique |
| Area | 1, rectangle du Rif `[-6.4,34.8]–[-3.6,35.9]`, converti en MultiPolygon par le service |
| Releases | 2 : satellite publiée et release témoin draft, non sélectionnable par le service |
| Assets | 2, avec véritables fichiers JSON de fixture, tailles et SHA-256 calculés |
| Runs | 2, ingestion synthétique déclarée et manifeste associé |
| Partitions | 5 : principale, chevauchante, quarantined, non servable, autre release |
| Détections | **264 au total**, dont **256 admissibles** et **8 exclues** |
| Analyse | 1 créée par `analysesService.createAnalysis`, UTC, standard, native_detections_v1, grid_id=null |
| Composants | satellite ready ; weather_historical et reports missing, créés par le service |
| Jobs/outbox | analyse par le service ; trois exports par `exportsService.create` avec l'option explicite correspondante |

Les 256 points admissibles sont répartis en groupes de 64 près de Larache,
Chefchaouen, Tétouan et Al Hoceïma. Ce sont des **positions synthétiques**, pas
des observations d'incendies réels. Période UTC : `[2026-08-01,2026-08-04[`.
Il y a 128 points day, 128 night, une somme FRP de 1 408 MW et un maximum de
10,5 MW. Les coordonnées sont `[longitude, latitude]` en EPSG:4326 ; seule la
génération MVT les projette en 3857.

Les huit témoins doivent être absents de tous les résultats : hors AOI,
avant la période, exactement à la borne de fin exclusive, traitement nrt,
absence de partition, autre release uniquement, partition quarantined et
partition non servable. Le premier point admissible appartient à deux
partitions valides de la même release : il doit être compté **une seule fois**.

La partition principale contient 260 lignes, y compris quatre témoins de
sélection. Les autres partitions en contiennent chacune une ; leurs
`row_count`, fichiers et SHA-256 correspondent réellement à leurs membres.
Une détection sans rattachement reste présente dans l'asset de test, afin de
vérifier qu'un simple lien asset/release ne suffit pas à la servir.

Des textes `=1+1`, `+SUM(1,1)`, `-test`, `@test`, une formule précédée
d'espaces, ainsi que guillemets/virgule/retour à la ligne permettent de tester
la neutralisation et le parsing CSV.

## Plan avant toute modification de base

1. Examiner cet aperçu et désigner une infrastructure isolée.
2. Obtenir l'accord explicite pour exécuter le seed ; rien n'est lancé
   automatiquement par un build, un test, un démarrage API ou worker.
3. Vérifier les cibles, versions, tables, FK, SRID et GiST. Refuser si la base
   est également configurée comme base applicative, si Redis est partagé avec
   la configuration applicative, ou si les versions ne correspondent pas.
4. Sous verrou advisory propre à la fixture, rechercher une source identique
   et une area identique ; utiliser leurs services pour les créer si nécessaire.
5. Insérer les assets/releases/runs/partitions/points/rattachements complets
   dans une transaction SQL, car aucun service d'ingestion n'existe pour eux.
   `ON CONFLICT DO NOTHING` est suivi d'une comparaison du contenu attendu :
   une collision ou une dérive provoque un refus, sans écraser l'existant.
6. Créer ou réutiliser l'analyse par son service. Vérifier le propriétaire
   et la release effectivement sélectionnée. Le job et son outbox viennent
   de la transaction applicative, pas d'enregistrements artificiellement prêts.
7. Démarrer explicitement le worker isolé. Attendre la complétion de l'analyse.
8. Sur demande explicite `--queue-exports`, créer les trois exports via le
   service, successivement, pour respecter le quota de deux jobs actifs.
   Vérifier la sélection applicative des 256 points avant leur création.
9. Tester HTTP et vérifier le contenu des fichiers avec les scripts fournis.

Le service d'analyse résout actuellement la release publiée globalement,
sans filtre par scope. La fixture **refuse la présence d'une autre release
publiée compatible**, plutôt que de modifier son cutoff, son état ou la
logique applicative. Utiliser une autre base de test dans ce cas. Pendant la
préparation initiale, éviter les autres producteurs métier sur cette base ;
le verrou coordonne les seeds, pas tous les producteurs de releases possibles.

Les appels de services et l'ingestion ont leurs propres transactions : un
échec tardif peut laisser des étapes de fixture complètes déjà créées. Une
relance les vérifie et les réutilise ; aucun nettoyage destructif n'est fait.
Seuls les workers font évoluer normalement leurs analyses/jobs dédiés.

## Reproductibilité et isolation

- Namespace et demandeur stables : `phase4-rif-v1` et `phase4-fixture:rif:v1`.
- Empreinte logique stable :
  `89d0f21af494e90da34c53d308cef70b65b0503f222f41826fa0c1f42b929575`.
- UUID des releases/assets/runs/partitions déterminés par SHA-256 du namespace.
- Les services créent leurs propres UUID source/area/analyse/jobs, et PostgreSQL
  alloue les bigint des détections : ces identifiants physiques ne sont pas
  garantis identiques entre deux bases neuves. Les relances dans une même base
  les réutilisent ; `manifest.json` contient la correspondance complète.
- Pas de `OVERRIDING SYSTEM VALUE`, de remplacement de générateur UUID ou de
  contournement de FK pour forcer ces identifiants. Un INSERT en conflit peut
  consommer des valeurs de séquence sans ajouter de ligne : les trous d'ID
  sont normaux et ne changent pas les résultats attendus.
- Répertoire dédié `.data/phase4-rif-v1/<nom_base_test>`, distinct du stockage de développement et séparé par base de test.
  Les fichiers d'asset/partition et le manifeste sont créés exclusivement ;
  s'ils existent avec un autre contenu, ils ne sont pas écrasés.
- Aucun secret, token ou URL PostgreSQL/Redis n'est enregistré dans le manifeste.
- Aucun fournisseur externe, migration, table ou dépendance npm supplémentaire.

## Fichiers livrés

| Fichier | Responsabilité |
| --- | --- |
| `scripts/phase4/fixture.mjs` | données déterministes et oracle XYZ |
| `scripts/phase4/environment.mjs` | garde des cibles et audit réel avant insertion |
| `scripts/phase4/ingestion.mjs` | insertion complète et contrôle des collisions |
| `scripts/phase4/artifacts.mjs` | fichiers de provenance et manifestes sans écrasement |
| `scripts/phase4/seed.mjs` | aperçu par défaut, orchestration explicite des services |
| `scripts/phase4/runtime.mjs` | API locale authentifiée et worker existant sur infrastructure de test uniquement |
| `scripts/phase4/mvt.mjs` | décodeur limité aux tuiles Point PostGIS de cette fixture |
| `scripts/phase4/verify.mjs` | vérification effective MVT, CSV, GeoJSON et Parquet |
| `scripts/phase4/requests/*.json` | corps HTTP pour curl, compatibles avec PowerShell |
| `apps/api/tests/phase4.fixture.test.ts` | tests sans base des données, gardes et vérificateurs |
| `package.json` | commandes supplémentaires, aucun hook automatique de seed |

Le décodeur s'appuie sur le [contrat protobuf MVT officiel](https://github.com/mapbox/vector-tile-spec/blob/master/2.1/vector_tile.proto).
Il vérifie le format produit par cette API ; ce n'est pas un lecteur universel
pour des couches polygonales ou des extensions protobuf arbitraires.

## Commandes exactes — aperçu et préparation autorisée

PowerShell, depuis la racine :

```powershell
# Sans connexion ni écriture : commande déjà vérifiée pendant la préparation.
npm.cmd run seed:phase4

# Compiler les services et workers utilisés par les scripts.
npm.cmd run build
```

**Uniquement après accord pour insérer les données**, sur une base de test dont
les tables/migrations existent déjà :

```powershell
$env:TEST_DATABASE_URL = 'postgresql://test:test@localhost:5432/firebridge_test'
$env:TEST_REDIS_URL = 'redis://localhost:6379/15'
npm.cmd run seed:phase4 -- --apply --confirm-database firebridge_test
```

Adapter les credentials à l'environnement réellement provisionné. Le script
ne crée pas la base et ne lance pas de migration. Ne pas exporter les mêmes
cibles dans `DATABASE_URL`/`REDIS_URL` : les gardes refuseront une cible qui
est aussi configurée comme cible applicative. Une base `_test` doit être
réellement réservée aux tests : le suffixe seul n'est pas une preuve suffisante
de son affectation. Un `NODE_ENV=production` est refusé.

Le script observe le schéma d'installation PostGIS (`public` ou `firebridge`)
et adapte seulement le paramètre `schema` de la connexion de son processus,
pour les fonctions PostGIS non qualifiées des services existants. Toutes les
tables métier restent explicitement dans `firebridge`. Aucun `ALTER ROLE`,
`ALTER DATABASE` ou changement du `.env` n'est fait.

Le premier passage crée l'analyse **queued**, pas un faux succès. Les références
sont écrites dans `.data/phase4-rif-v1/firebridge_test/manifest.json` pour la cible d'exemple. Un audit du catalogue
réel est conservé séparément, avec un nom horodaté.

## API locale authentifiée et worker isolé

Le serveur standard n'a toujours aucun vérificateur d'identité intégré.
Un header arbitraire `X-User-Id` ou un Bearer non vérifié ne donne aucun accès.
Le lanceur ci-dessous est une aide **réservée aux tests** : il refuse production,
exige les cibles isolées et écoute exclusivement `127.0.0.1`.

Terminal API : définir les deux variables `TEST_*` ci-dessus, puis :

```powershell
$env:PHASE4_TEST_TOKEN = [guid]::NewGuid().ToString('N')
# Conserver ce token pour le terminal curl, sans le mettre dans un fichier versionné.
npm.cmd run phase4:api
```

Terminal worker : définir les mêmes `TEST_*`, puis :

```powershell
npm.cmd run phase4:worker
```

Le token local est comparé en temps constant puis associé au demandeur de la
fixture. Il n'est ni enregistré ni journalisé. Ces commandes n'insèrent pas
les données de fixture. Le worker consomme normalement l'outbox et produit
les fichiers dans `.data/phase4-rif-v1/firebridge_test/exports` pour la cible d'exemple.

Pour tester naturellement le statut 410 dans un passage dédié, on peut définir
avant de démarrer ce worker `$env:EXPORT_RETENTION_SECONDS = '60'` et
`$env:EXPORT_CLEANUP_INTERVAL_SECONDS = '10'`. Après expiration, répéter le GET
download sans `--fail`, avec `--write-out 'HTTP %{http_code}\n'` : le résultat
attendu est 410. Ces paramètres affectent seulement le processus de test ;
aucun enregistrement n'est modifié artificiellement pour simuler l'expiration.

Pour demander les trois formats directement par les services, avec le worker
actif et **après accord d'exécution du seed**, reprendre dans le terminal seed :

```powershell
npm.cmd run seed:phase4 -- --apply --confirm-database firebridge_test --queue-exports
```

Le programme attend la complétion réelle de l'analyse, puis de chaque export.
Il ne lance pas de processor dans le processus du seed. Les références finales
sont dans `.data/phase4-rif-v1/firebridge_test/exports-v1.json`. En cas de timeout, démarrer le
worker et relancer : les jobs sont préservés et les clés sont idempotentes.
Pour un nouveau lot après expiration/échec, utiliser explicitement
`--export-run v2`, puis éventuellement v3 ; ne pas changer les jobs précédents.

## Commandes curl des trois endpoints

Terminal HTTP : conserver les mêmes cibles de test pour les scripts éventuels,
et recopier **le même token** que celui du terminal API :

```powershell
$base = 'http://127.0.0.1:3104/api/v1'
$token = '<PHASE4_TEST_TOKEN du terminal API>'
$m = Get-Content -Raw '.data/phase4-rif-v1/firebridge_test/manifest.json' | ConvertFrom-Json
$analysisId = $m.analysis_id
$out = '.data/phase4-rif-v1/firebridge_test/http'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Wait-Phase4Job($id) {
  $until = (Get-Date).AddMinutes(6)
  do {
    curl.exe --silent --show-error --fail -H "Authorization: Bearer $token" "$base/jobs/$id" -o "$out/job-status.json"
    if ($LASTEXITCODE -ne 0) { throw 'Job tracking request failed' }
    $status = (Get-Content -Raw "$out/job-status.json" | ConvertFrom-Json).data.status
    if ($status -in @('failed','cancelled') -or (Get-Date) -gt $until) { throw 'Export failed or timed out' }
    if ($status -ne 'succeeded') { Start-Sleep -Seconds 1 }
  } until ($status -eq 'succeeded')
}

# Attendre completed_at non nul et l'état ready/partial après passage du worker.
curl.exe --silent --show-error --fail -H "Authorization: Bearer $token" "$base/analyses/$analysisId"

# 1. MVT : agrégation mondiale, quatre tuiles zoom 8, puis tuile vide.
curl.exe --silent --show-error --fail -D "$out/world.headers" -H "Authorization: Bearer $token" "$base/analyses/$analysisId/tiles/detections/0/0/0.mvt" -o "$out/world.mvt"
foreach ($tile in @('123/101','124/100','124/101','125/101')) {
  $name = $tile.Replace('/', '-')
  curl.exe --silent --show-error --fail -H "Authorization: Bearer $token" "$base/analyses/$analysisId/tiles/detections/8/$tile.mvt" -o "$out/z8-$name.mvt"
}
curl.exe --silent --show-error --fail -H "Authorization: Bearer $token" "$base/analyses/$analysisId/tiles/detections/8/0/0.mvt" -o "$out/empty.mvt"

# 2. POST export. Cette clé réutilise le job CSV si --queue-exports a déjà été lancé.
curl.exe --silent --show-error --fail -D "$out/create-csv.headers" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -H 'Idempotency-Key: phase4-rif-v1:v1:csv' --data-binary '@scripts/phase4/requests/csv.json' "$base/analyses/$analysisId/exports" -o "$out/csv-job.json"
$jobId = (Get-Content -Raw "$out/csv-job.json" | ConvertFrom-Json).data.job_id

# Suivi réel. Attendre succeeded avant le téléchargement ; failed exige une investigation.
curl.exe --silent --show-error --fail -H "Authorization: Bearer $token" "$base/jobs/$jobId"
Wait-Phase4Job $jobId

# 3. Download. Avant succeeded, le contrat renvoie 409.
curl.exe --silent --show-error --fail -D "$out/csv.headers" -H "Authorization: Bearer $token" "$base/jobs/$jobId/download" -o "$out/export.csv"
```

Répéter pour GeoJSON et Parquet après avoir attendu chaque job :

```powershell
foreach ($format in @('geojson','parquet')) {
  curl.exe --silent --show-error --fail -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -H "Idempotency-Key: phase4-rif-v1:v1:$format" --data-binary "@scripts/phase4/requests/$format.json" "$base/analyses/$analysisId/exports" -o "$out/$format-job.json"
  $jobId = (Get-Content -Raw "$out/$format-job.json" | ConvertFrom-Json).data.job_id
  Wait-Phase4Job $jobId
  curl.exe --silent --show-error --fail -D "$out/$format.headers" -H "Authorization: Bearer $token" "$base/jobs/$jobId/download" -o "$out/export.$format"
}
```

Les corps JSON sont des fichiers afin d'éviter la perte de guillemets dans les
arguments natifs sous Windows PowerShell. Le token reste dans le header,
jamais dans une URL. Si les fichiers du lot v1 ont expiré, choisir un nouveau
label de lot dans le seed et dans les clés des commandes HTTP.

## Vérification réelle des fichiers téléchargés

```powershell
node scripts/phase4/verify.mjs mvt "$out/world.mvt" 0/0/0
node scripts/phase4/verify.mjs mvt "$out/empty.mvt" 8/0/0
foreach ($tile in @('123/101','124/100','124/101','125/101')) {
  $name = $tile.Replace('/', '-')
  node scripts/phase4/verify.mjs mvt "$out/z8-$name.mvt" "8/$tile"
}
node scripts/phase4/verify.mjs csv "$out/export.csv" '.data/phase4-rif-v1/firebridge_test/manifest.json'
node scripts/phase4/verify.mjs geojson "$out/export.geojson" '.data/phase4-rif-v1/firebridge_test/manifest.json'
node scripts/phase4/verify.mjs parquet "$out/export.parquet" '.data/phase4-rif-v1/firebridge_test/manifest.json'
```

Chaque vérification réussie renvoie du JSON et le code de sortie 0 ; une
différence renvoie le code 1. Le vérificateur n'ouvre aucune connexion réseau.
Il est destiné à cette petite fixture et aux exports complets non filtrés.
Les cas filtrés `day` et `night` doivent chacun contenir 128 détections ; utiliser
une clé d'idempotence différente pour tout changement de filtre.

## Critères d'acceptation

- **Géométrie/FK** : deux types géométriques attendus en SRID 4326, contraintes
  réellement présentes, GiST existant, aucune FK désactivée. L'audit du catalogue
  produit après autorisation est la preuve de ces vérifications sur la cible.
- **Analyse** : release satellite attendue, demandeur de fixture, UTC/standard,
  `grid_id=null`. Attendre `completed_at` non nul : le service peut calculer
  un statut effectif partial avant la fin du worker.
- **MVT HTTP** : 200, MIME `application/vnd.mapbox-vector-tile`, cache privé ;
  corps protobuf valide et pas simplement une réponse non vide ou un JSON.
- **MVT contenu** : couche detections, version 2, extent 4096, géométries Point,
  coordonnées projetées/quantifiées attendues à un pixel près, propriétés
  limitées à count/frp_mw. Le vérificateur décode réellement ces champs.
- **Conservation** : somme de count = **256** sur la tuile mondiale ; **64**
  pour chacune des quatre tuiles zoom 8, soit **256** au total. Le nombre de
  features peut être inférieur au nombre de détections : c'est l'agrégation.
  La tuile 8/0/0 doit être vide. Le manifeste donne toutes les attentes aux
  zooms 0, 4, 8, 12, 16 et 18 ; ne pas comparer le nombre de features au seul
  nombre brut de points.
- **Exports** : 202 à la demande ; le même job pour le même payload/clé ; job
  et événement export.requested cohérents ; progression par le worker, succès
  réel, fichier référencé, taille/hash/expiration renseignés.
- **Trois formats** : **256 lignes/features** chacun, mêmes identifiants exacts,
  source, coordonnées, timestamps UTC, day/night et FRP que le manifeste.
  Aucun des huit témoins, aucune duplication du point multi-partitions.
- **CSV** : véritable parsing des guillemets et retours à la ligne, pas un
  comptage des lignes physiques ; apostrophe sur les textes dangereux.
  GeoJSON/Parquet conservent le texte original. Parquet est ouvert et parcouru
  par curseur, pas validé uniquement à partir des octets PAR1.
- **Download** : 200 après succès, MIME/disposition/taille corrects ; 409 avant
  succès ; 410 après expiration réelle ; 404 pour ressource inconnue/inaccessible.
  Ne pas simuler l'expiration en modifiant une ligne métier : prévoir une
  rétention courte configurable sur une nouvelle base/run de test.
- **Accès** : le lanceur local rejette un token absent ou incorrect avec 401.
  Les essais entre deux utilisateurs restent couverts par les tests HTTP
  existants ; ce lanceur mono-identité n'est pas une simulation multi-tenant.
- **Performance** : ce jeu de 264 points vérifie la correction fonctionnelle,
  pas la capacité en production. La présence de GiST ne garantit pas que le
  planificateur le choisisse sur une aussi petite table ; mesurer séparément
  avec le test d'intégration volumique déjà fourni.

## Contrôles effectués pendant la préparation

- Aperçu `npm.cmd run seed:phase4` : exécuté avec succès, sans connexion/écriture.
- Tests ciblés de fixture : **20/20 réussis**, un fichier, dernier passage en
  **1,36 s** ; tests des trois writers réels et des vérificateurs en mémoire,
  sans base. Commande :
  `npm.cmd run test --workspace @firebridge/api -- --run tests/phase4.fixture.test.ts`.
- `npm.cmd run lint` : succès, zéro erreur.
- `npm.cmd run typecheck` : succès, zéro erreur sur les projets TypeScript configurés.
- `node --check` sur tous les scripts `.mjs` ajoutés : succès.
- `git diff --check` : succès, seulement les avertissements habituels de
  conversion LF/CRLF sur des fichiers déjà modifiés auparavant.
- Le seed avec `--apply`, les lanceurs API/worker et les appels curl **n'ont
  pas été exécutés**, conformément à la demande d'accord préalable.
- Aucune validation réelle du SQL d'insertion ou de la fixture dans PostgreSQL
  n'est revendiquée avant cette exécution autorisée.
