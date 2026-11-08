# Architecture des endpoints Fastify

Les endpoints implémentés suivent la même séparation que les zones et analyses de phase 2 et les résultats de phase 4 :

```text
Requête HTTP
    → route + middlewares + schéma
    → controller
    → service
    → repository
    → PostgreSQL/PostGIS
```

La réponse remonte ensuite jusqu'au controller, qui retourne le résultat HTTP via Fastify. Les travaux longs passent par un job durable, l'outbox et le worker.

## Responsabilités

| Couche          | Responsabilité                                                                                                                                   | Exemple                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `routes/`       | Déclarer méthode, chemin, schémas Swagger/Fastify, hooks et controller associé.                                                                  | `areas.routes.ts` associe `POST /areas` à `areasController.create`.                                                 |
| `controllers/`  | Lire les paramètres HTTP, appliquer les validateurs applicatifs, appeler le service, choisir statut et en-têtes, préparer la réponse.            | `areas.controller.ts` valide le corps et renvoie 201 pour une création ou 200 pour une réutilisation.               |
| `validators/`   | Décrire et vérifier la structure des entrées avec Zod. Les schémas JSON des routes assurent également la validation Fastify et la documentation. | `areas.validator.ts`, `ingestion.validator.ts`.                                                                     |
| `services/`     | Appliquer les règles métier et coordonner les lectures/écritures.                                                                                | `areas.service.ts` prépare la géométrie, calcule son empreinte et demande une insertion ou réutilisation.           |
| `repositories/` | Exécuter les requêtes paramétrées et les transactions SQL, puis retourner les enregistrements nécessaires.                                       | `areas.repository.ts` utilise Prisma et PostGIS pour valider et enregistrer la zone.                                |
| `middleware/`   | Appliquer des contrôles HTTP communs aux routes concernées.                                                                                      | Administration de l'ingestion, idempotence HTTP, disponibilité des résultats et limitation des requêtes de phase 4. |

Les repositories peuvent appeler PostGIS pour des calculs spatiaux. Les services gardent la décision métier liée à ces résultats. Le découpage se fait par fonctionnalité : un service n'est pas nécessaire pour chaque endpoint.

## Exemple de phase 2 : créer une zone

1. Fastify trouve la déclaration `POST /api/v1/areas` dans `areas.routes.ts`.
2. `areasController.create` vérifie le corps avec `areaCreateSchema`.
3. `areasService.createArea` transforme les coordonnées en WKT, demande la validation PostGIS et calcule l'empreinte de la géométrie.
4. `areasRepository.createAtomic` insère la zone ou récupère une zone équivalente selon la contrainte d'unicité.
5. Le service retourne la zone et le booléen `created`.
6. Le controller renvoie le JSON et le statut 201 ou 200.

Le controller ne construit pas les requêtes SQL. Le repository ne choisit pas le statut HTTP de succès.

## Controllers des phases 1, 3, 5 et 6

Les handlers auparavant intégrés dans les routes sont extraits dans les fichiers suivants. Les chemins publics, services, repositories et contrats HTTP sont conservés.

| Phase | Routes                     | Controller                     | Service                  |
| ----- | -------------------------- | ------------------------------ | ------------------------ |
| 1     | `catalog.routes.ts`        | `catalog.controller.ts`        | `CatalogService.catalog` |
| 1     | `releases.routes.ts`       | `releases.controller.ts`       | `CatalogService.release` |
| 1     | `updates.routes.ts`        | `updates.controller.ts`        | `CatalogService.updates` |
| 3     | `native-results.routes.ts` | `native-results.controller.ts` | `NativeResultsService`   |
| 5     | `ingestion.routes.ts`      | `ingestion.controller.ts`      | `IngestionService`       |
| 6     | `context.routes.ts`        | `context.controller.ts`        | `ContextService`         |
| 6     | `context.routes.ts`        | `explanation.controller.ts`    | `ExplanationService`     |

Les controllers accèdent aux services avec `request.server`, par exemple `request.server.catalogService`. Les services sont construits et enregistrés par application Fastify dans `app.ts`. Cela conserve l'isolation entre deux instances de l'application et les dépendances injectées dans les tests. Les endpoints de phase 2/4 utilisent aussi des objets services importés ; les responsabilités restent les mêmes.

### Exemple : lire la météo d'une analyse

```text
GET /api/v1/analyses/{id}/weather
    → context.routes.ts : chemin et schéma de requête
    → contextController.weather : validation et contexte de pagination
    → ContextService.weather : règles de sélection des données figées
    → ContextRepository : lecture SQL
    → controller : enveloppe JSON
```

### Exemple : demander une ingestion

Le hook d'administration reste sur les cinq routes administratives. `ingestionController.backfill` valide le corps, récupère l'acteur et la clé d'idempotence, puis appelle `IngestionService.backfill`. Le service et le repository conservent la création transactionnelle du plan, du job et de l'événement d'outbox. Le controller traduit le résultat en réponse 202 ou en rejeu 200.

Cette séparation ne fournit pas un nouvel exécuteur NASA : le worker d'ingestion reste limité à la planification.

## Contrats à préserver lors d'une réorganisation

- Méthodes, chemins, paramètres et schémas OpenAPI.
- Statuts, enveloppes JSON, en-têtes de cache, ETags et réponses 304.
- Curseurs signés et limites des sélections sauvegardées.
- Clés d'idempotence, scopes, protection de l'ingestion et atomicité job/outbox.
- Distinction entre données absentes, zéro, résultat partiel et calcul scientifique non supporté.

Les anciens endpoints génériques qui renvoient explicitement 501 restent des squelettes. Ils sont distincts des chemins implémentés liés aux analyses. L'extraction des controllers ne les implémente pas et ne les supprime pas ; leur suppression demande de vérifier le contrat et leurs éventuels consommateurs.

## Validation

Les suites de routes existantes vérifient le parcours HTTP complet à travers les controllers et services. Les suites PostgreSQL/PostGIS vérifient les requêtes réelles et les limites spatiales. Les tests workers couvrent la consommation des événements durables. La réorganisation ne nécessite aucune migration de base de données.
