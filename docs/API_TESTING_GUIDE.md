# Vérifier FIREBRIDGE sans remplacer les services actuels

Depuis la racine du projet, Docker Desktop et les conteneurs PostgreSQL/Redis
existants doivent être disponibles. Le workflow lit la connexion locale du `.env`
sans la modifier ni la journaliser. Il refuse les bases distantes/production.
Node/npm, les dépendances du projet et le port libre 127.0.0.1:3104 sont requis.

```powershell
npm.cmd run audit:api -- --preview
npm.cmd run audit:api
```

Cette commande sauvegarde/restaure/compare la base historique, provisionne les
bases de test si absentes, compile, contrôle les types et le lint, exécute les
tests unitaires, prépare la fixture, construit les deux images, démarre uniquement
le projet `firebridgeaudit`, attend les healthchecks, exécute l’intégration et le
smoke HTTP, puis génère [API_TEST_REPORT.md](API_TEST_REPORT.md).

Elle ne remplace pas le serveur sur localhost:3000. Le refus de ce remplacement
est respecté. Elle conserve les données de test et attend l’expiration naturelle
des fichiers (180 secondes), ainsi que les fenêtres de rate limiting si besoin.
Compter plusieurs minutes. Une erreur produit un code de sortie non nul et un
rapport partiel ; consulter `.data/audit/*.log`. Ne pas conclure PASS à partir de
la seule santé Docker.

## Commandes séparées

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test

# Bases de test préalablement provisionnées ; adapter uniquement les credentials.
$env:TEST_DATABASE_URL = 'postgresql://<utilisateur>:<mot-de-passe>@localhost:5432/firebridge_integration_test?schema=firebridge'
$env:TEST_REDIS_URL = 'redis://localhost:6379/14'
npm.cmd run test:integration
```

L’intégration active les tests PostgreSQL/PostGIS/BullMQ et les tests habituels.
Les suites refusent la connexion réelle du développement et ne font aucun reset.
Le détail de la fixture et les commandes de seed se trouvent dans
[TEST_FIXTURES.md](TEST_FIXTURES.md).

Après un workflow complet, vérifier la santé et les images utilisées :

```powershell
$dockerExe = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe"
& $dockerExe inspect --format '{{.Name}} {{.Image}} {{.State.Health.Status}}' firebridge-audit-api firebridge-audit-worker firebridge-postgres firebridge-redis
& $dockerExe logs --tail 30 firebridge-audit-api
& $dockerExe logs --tail 30 firebridge-audit-worker
curl.exe --silent --show-error http://127.0.0.1:3104/api/v1/health/ready
```

La reconstruction seule (sans redémarrer le projet initial) est :

```powershell
& $dockerExe compose -f docker-compose.yml build api worker
```

Le lanceur complet dérive en mémoire l’URL de test pour démarrer les conteneurs
distincts avec `docker-compose.audit.yml`. Ne pas utiliser `up` avec l’override
`docker-compose.test.yml` sur les services historiques.

## Curl : MVT, export, suivi et téléchargement

L’auth standard n’a pas encore de fournisseur d’identité configuré. Pour les
seuls conteneurs de test, le workflow crée des tokens opaques aléatoires d’une
heure. Ne pas afficher/commiter les fichiers ni mettre le token dans l’URL.

```powershell
$base = 'http://127.0.0.1:3104/api/v1'
$credentials = Get-Content -Raw '.data/audit/client-tokens.json' | ConvertFrom-Json
$token = $credentials.owner
$manifestPath = '.data/phase4-rif-v1/firebridge_phase4_test/manifest.json'
$m = Get-Content -Raw $manifestPath | ConvertFrom-Json
$analysisId = $m.analysis_id
$out = '.data/audit/manual'
New-Item -ItemType Directory -Force -Path $out | Out-Null

curl.exe --fail --silent --show-error -H "Authorization: Bearer $token" "$base/analyses/$analysisId"
curl.exe --fail --silent --show-error -D "$out/world.headers" -H "Authorization: Bearer $token" "$base/analyses/$analysisId/tiles/detections/0/0/0.mvt" -o "$out/world.mvt"
curl.exe --fail --silent --show-error -H "Authorization: Bearer $token" "$base/analyses/$analysisId/tiles/detections/8/124/100.mvt" -o "$out/z8-124-100.mvt"
curl.exe --fail --silent --show-error -H "Authorization: Bearer $token" "$base/analyses/$analysisId/tiles/detections/8/0/0.mvt" -o "$out/empty.mvt"
node scripts/phase4/verify.mjs mvt "$out/world.mvt" 0/0/0
node scripts/phase4/verify.mjs mvt "$out/z8-124-100.mvt" 8/124/100
node scripts/phase4/verify.mjs mvt "$out/empty.mvt" 8/0/0

# Nouveau lot explicite : ne pas réutiliser la clé d’un fichier déjà expiré.
$runLabel = [guid]::NewGuid().ToString('N')
foreach ($format in @('csv','geojson','parquet')) {
  curl.exe --fail --silent --show-error -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -H "Idempotency-Key: manual-$runLabel-$format" --data-binary "@scripts/phase4/requests/$format.json" "$base/analyses/$analysisId/exports" -o "$out/$format-job.json"
  if ($LASTEXITCODE -ne 0) { throw 'Création export refusée ; consulter le statut/quota.' }
  $jobId = (Get-Content -Raw "$out/$format-job.json" | ConvertFrom-Json).data.job_id
  $deadline = (Get-Date).AddMinutes(5)
  do {
    curl.exe --fail --silent --show-error -H "Authorization: Bearer $token" "$base/jobs/$jobId" -o "$out/status.json"
    if ($LASTEXITCODE -ne 0) { throw 'Suivi job refusé.' }
    $status = (Get-Content -Raw "$out/status.json" | ConvertFrom-Json).data.status
    if ($status -in @('failed','cancelled') -or (Get-Date) -gt $deadline) { throw 'Worker en échec ou délai dépassé.' }
    if ($status -ne 'succeeded') { Start-Sleep -Seconds 1 }
  } until ($status -eq 'succeeded')
  curl.exe --fail --silent --show-error -D "$out/$format.headers" -H "Authorization: Bearer $token" "$base/jobs/$jobId/download" -o "$out/export.$format"
  if ($LASTEXITCODE -ne 0) { throw 'Téléchargement refusé.' }
  node scripts/phase4/verify.mjs $format "$out/export.$format" $manifestPath
  if ($LASTEXITCODE -ne 0) { throw 'Contenu export incorrect.' }
}
```

Respecter 5 demandes d’export/minute et 10 nouveaux jobs/heure ; une réponse 429
ne justifie pas de supprimer des clés Redis ou des jobs. Les clés identiques
doivent être rejouées avec exactement le même payload. La rétention de test est
courte : télécharger aussitôt le job réussi. Après expiration, download renvoie
410 et le même job ne régénère pas son fichier.

## Contrôles d’erreur

Omettre Authorization → 401 ; token invalide/expiré → 401 ; token `limited` →
403 ; token `other` sur une analyse/tuile/job privé → 404. La tuile vide valide
renvoie 200 avec MIME MVT et zéro feature ; UUID/layer/XYZ invalides → 400.
Un job non réussi renvoie 409 au download. Un job inexistant → 404.

```powershell
curl.exe --silent --show-error -w '\nHTTP %{http_code}\n' "$base/analyses/$analysisId/tiles/detections/0/0/0.mvt"
curl.exe --silent --show-error -H "Authorization: Bearer $($credentials.other)" -w '\nHTTP %{http_code}\n' "$base/analyses/$analysisId"
curl.exe --silent --show-error -H "Authorization: Bearer $token" -w '\nHTTP %{http_code}\n' "$base/analyses/$analysisId/tiles/detections/8/256/0.mvt"
```

## Preuves à consulter

- `docs/API_TEST_REPORT.md` : commandes, codes de sortie et tableau HTTP attendu/réel.
- `.data/audit/report.json`, `http-results.json` : durées, résumés de réponse,
  vérifications SQL/cache/fichier et assertions en échec, sans secrets.
- `.data/audit/baseline.json`, `after.json` : nombre et hash des 48 tables historiques.
- `.data/audit/original-containers.json` : IDs/images initiaux, comparés en fin de run.
- `.data/audit/fixture*.log` et manifestes : création/réutilisation et jobs transactionnels.
- `.data/audit/integration-final.log` : retries réels, concurrence, RSS, EXPLAIN et timings.
- `.data/audit/http/export.*` : fichiers réellement téléchargés et vérifiés.

Une validation MVT exige décodage protobuf/couche/Point/count/coordonnées. Une
validation Parquet exige ouverture et lecture des lignes, au-delà de PAR1.
Le smoke compare aussi la taille et le SHA-256 aux métadonnées SQL. Les preuves
de sécurité et de streaming complètent ces contrôles de contenu.
