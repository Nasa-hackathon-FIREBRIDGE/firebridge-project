# Phase 5 : ingestion et opérations

La phase 5 expose six endpoints Fastify. Ils permettent de consulter les abonnements,
les tentatives de téléchargement, les lacunes et la fraîcheur d’une source, ainsi que
de demander un backfill ou une relance bornée.

## Périmètre livré et limite d’exécution

| Méthode | Route sous `/api/v1`                          | Fonction                                                          |
| ------- | --------------------------------------------- | ----------------------------------------------------------------- |
| GET     | `/admin/ingestion/subscriptions`              | Abonnements, cadence, checkpoints et dernier résultat             |
| POST    | `/admin/ingestion/backfills`                  | Créer/réutiliser un abonnement et enregistrer une demande durable |
| POST    | `/admin/ingestion/subscriptions/{id}/refresh` | Demander un poll, repair ou reconcile borné                       |
| GET     | `/admin/ingestion/runs/{id}`                  | Lire une tentative `fetch_runs`, ses assets et ses contrôles      |
| GET     | `/admin/ingestion/gaps`                       | Lister les lacunes avec pagination signée                         |
| GET     | `/sources/{source_id}/availability`           | Disponibilité fournisseur et fraîcheur locale pour un scope       |

**Cette livraison prépare et observe l’ingestion ; elle ne télécharge ni ne publie encore de données NASA.**
Le dépôt n’a pas encore d’adaptateur de téléchargement/normalisation/publication.
Les réponses de demande indiquent `execution_support="planning_only"` et les volumes
estimés inconnus restent `null`. Le worker crée les `fetch_runs` à l’état `queued`, puis
laisse le job en `queued`, avec `progress.stage="awaiting_fetch_executor"` et sans date
de fin. Aucun compteur de réussite, checkpoint ou release n’est fabriqué.

La planification périodique automatique reste à développer. Les nouveaux abonnements
backfill ont `enabled=false` ; une demande explicite les planifie tout de même.
Les lectures ne modifient pas les horaires, les états des lacunes ou les aliases.

## Chemin d’une demande

1. Fastify vérifie le token d’administration et les paramètres.
2. Le service vérifie le feed enregistré, sa version, ses produits, la zone et le scope,
   puis borne les dates et le nombre de chunks selon les capacités vérifiées et le budget.
3. Une transaction PostgreSQL enregistre l’abonnement, `api_jobs` et `outbox_events` ensemble.
4. Le dispatcher envoie `ingestion.plan.requested` à BullMQ/Redis.
5. Le planificateur du worker verrouille le job et l’abonnement, revalide le feed,
   puis crée/réutilise les tentatives bornées. Un rejeu ne duplique pas les tâches en attente.
6. Un futur exécuteur devra récupérer les réponses, conserver les octets/hashes,
   vérifier les volumes et limites du fournisseur, normaliser, avancer les checkpoints
   contigus et publier atomiquement. La file ne constitue pas une preuve de téléchargement.

Les demandes sont idempotentes dans PostgreSQL, sans dépendre d’un cache Redis.
Même clé et même demande normalisée : `200`, même job, `Idempotent-Replayed: true`.
Même clé et demande différente : `409 IDEMPOTENCY_CONFLICT`.
Nouvelle clé : nouveau job `202`, avec réutilisation éventuelle de l’abonnement.
Une rotation du token change l’identité opérationnelle utilisée pour ces clés.

## Configuration de l’administration

Définir un `INGESTION_ADMIN_TOKEN` aléatoire d’au moins 32 caractères dans l’environnement
de l’API. Les cinq routes administratives attendent `Authorization: Bearer <token>`.
Sans configuration : `503 ADMIN_NOT_CONFIGURED`. Token absent ou incorrect : `401`.
La disponibilité par source reste publique et exige un `scope_key`.
Docker Compose transmet aussi ce token au conteneur API. Une valeur vide laisse
l’administration désactivée sans empêcher le démarrage du reste de l’API.
Le token ne doit jamais être commité ; ce mécanisme initial ne remplace pas un futur
annuaire d’utilisateurs, des rôles individuels ou un journal d’audit des administrateurs.

Swagger propose le bouton **Authorize** pour ce bearer. Les deux POST exigent aussi
un `Idempotency-Key` de 8 à 128 caractères (`A-Z`, `a-z`, chiffres, `.`, `_`, `:`, `-`).

Les requêtes ne reçoivent aucune URL fournisseur ou clé d’accès. Les feeds et leurs
références de credentials doivent être enregistrés par la configuration d’exploitation.
Une référence `env:NOM_DE_VARIABLE` est signalée configurée seulement si la variable
correspondante est définie. Les autres types de références restent non configurés
tant qu’un résolveur approprié n’est pas intégré.

Un feed doit être `active`, vérifié et décrire ses capacités bornées :

```json
{
  "ingestion_v1": {
    "max_chunk_seconds": 86400,
    "max_window_seconds": 31622400,
    "max_area_km2": 250000,
    "query_basis": "observation_time"
  }
}
```

Ces valeurs illustrent le contrat ; elles ne certifient aucune limite NASA.
L’enregistrement d’un véritable adaptateur devra utiliser ses capacités vérifiées.
La limite globale d’une demande est 366 jours et 366 chunks. Le budget d’octets est
conservé pour l’exécuteur ; le planificateur ne prétend pas connaître le volume réel.
Les `adapter_options` non vides sont actuellement refusées.

## Exemple de backfill

```json
{
  "feed_id": "modis",
  "area_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "scope_key": "phase1_test",
  "start": "2024-01-17T00:00:00Z",
  "end_exclusive": "2024-01-20T00:00:00Z",
  "source_ids": ["terra", "aqua"],
  "products": ["MCD14ML"],
  "collection": "6.1",
  "resource_budget": { "max_chunks": 3, "max_bytes": 1000000 }
}
```

Ce corps utilise exclusivement les fixtures synthétiques. Le plan prévoit trois chunks
d’un jour, pas trois téléchargements déjà réalisés. Tous les timestamps sont UTC ;
la borne de fin est exclue. Les périodes futures, les dates invalides, une sélection
hors feed, un scope inconnu, une zone trop grande ou un budget insuffisant sont refusés.

Une relance conserve le feed, les produits, la collection et la version d’adaptateur
enregistrés. Exemple :

```json
{
  "mode": "repair",
  "reason": "gap_repair",
  "resource_budget": { "max_chunks": 3, "max_bytes": 1000000 }
}
```

Sans fenêtre explicite, `repair` prend la première lacune ouverte dont la relance est due ;
`poll` reprend le checkpoint fetch avec l’overlap ; `reconcile` reprend la fenêtre
configurée. Le budget et la fenêtre maximale restent obligatoires à respecter.
Une relance nécessitant trop de travail est refusée : soumettre une fenêtre explicite
plus petite. `reason` accepte `manual`, `gap_repair` ou `provider_revision`.

## Lire la fraîcheur et les tentatives

La disponibilité renvoie les horodatages séparément : dernière tentative, dernier fetch
réussi, borne de checkpoint, dernière acquisition de la source et dernière publication.
Les acquisitions sont recherchées dans les assets de tentatives complètes du bon scope,
avec filtre exact sur la zone, les dates et le flux de la source. Le maximum global d’un
feed MODIS ne devient jamais automatiquement un timestamp Aqua.

Un résultat vide réussi peut mettre à jour la date de succès sans aucune acquisition.
`observation_coverage` reste `null`. L’absence de lacunes enregistrées n’est pas une preuve
d’inventaire complet ; `ingestion_completeness` reste `not_proven` dans ce cas.

La réponse expose aussi les détails par abonnement/feed. La borne agrégée `queried_through`
est conservatrice : minimum des checkpoints, ou `null` si l’un manque.
Les lacunes explicitement associées à une autre source sont exclues. Les lacunes sans
sélection source s’appliquent aux sources déclarées par leur feed.
Les lacunes d’un feed retiré encore ouvertes sont présentées `accepted_unavailable`,
sans prochaine relance, sans mutation cachée. Les nuages ne sont pas des lacunes d’ingestion.

La route runs attend un identifiant de `fetch_runs`, pas un job ou un pipeline UUID.
Elle ne publie ni requête brute, ni en-têtes, ni URI de stockage, ni message d’erreur
fournisseur. Les tableaux assets/contrôles sont bornés à 100 avec total et indicateur
de troncature. La disponibilité borne aussi sa liste de lacunes à 100, avec total ;
le calcul de l’état de fraîcheur tient compte des lacunes au-delà de cette limite.

Les listes abonnements/lacunes acceptent `limit=1..100` (50 par défaut) et un curseur
signé lié à l’endpoint, aux filtres, à la limite et à l’identité admin.
Les filtres sont documentés dans Swagger. Ces listes utilisent un ordre par UUID ;
ce ne sont pas des snapshots figés entre plusieurs pages d’opérations changeantes.

## Tests et essais manuels

Les tests rapides vérifient l’authentification, les contrats Swagger et les lectures
avec SQL embarqué. Les tests PostgreSQL/PostGIS/Redis vérifient les transactions réelles,
la concurrence, le rollback, les sources/produits, le planificateur, l’outbox et la fraîcheur
par source. Les deux suites PostgreSQL doivent être exécutées l’une après l’autre,
car elles utilisent la même base dédiée.

```powershell
$env:PHASE1_TEST_DATABASE_URL='postgresql://firebridge:firebridge@localhost:5432/firebridge_phase1_test'
$env:PHASE1_TEST_REDIS_URL='redis://localhost:16379'
npm.cmd run test:postgres --workspace @firebridge/api
npm.cmd run test:postgres --workspace @firebridge/worker
npm.cmd run fixtures:phase5 --workspace @firebridge/api
```

**La commande de fixtures remplace le contenu synthétique de la base dédiée**, y compris
ses demandes et événements d’outbox. Elle refuse toute autre base. Aucune fixture n’est
chargée au démarrage de l’application. Les exemples de tentatives déjà réussies/échouées
sont des données de test, pas le résultat d’un appel NASA.

Dans le terminal de l’API de test, créer un token de session et démarrer :

```powershell
$env:DATABASE_URL=$env:PHASE1_TEST_DATABASE_URL
$env:REDIS_URL=$env:PHASE1_TEST_REDIS_URL
$env:DEFAULT_SCOPE_KEY='phase1_test'
$env:PORT='3002'
$bytes=New-Object byte[] 32
$rng=[System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$env:INGESTION_ADMIN_TOKEN=[Convert]::ToBase64String($bytes)
npm.cmd run dev:api
```

Conserver le token dans un gestionnaire de secrets ou dans la session locale ; pour
le saisir dans Swagger **Authorize**, le consulter localement dans ce terminal avant
de démarrer le serveur, sans le publier dans un compte rendu. Ouvrir
`http://localhost:3002/api-docs/`, section **Phase 5**. Les identifiants synthétiques sont :

- abonnement : `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` ;
- tentative vide réussie : `f5000000-0000-4000-8000-000000000001` ;
- source/scopes : `terra` ou `aqua`, `phase1_test`.

Lancer le worker dans un autre terminal avec la **même base et le même Redis** pour
consommer la demande de planification. Ne pas le connecter au Redis d’un autre projet.
Le job résultant reste en attente de l’exécuteur ; une réponse `202` et une livraison
outbox ne prouvent aucune acquisition ou publication.
