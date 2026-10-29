# Tester manuellement les trois endpoints de phase 1

## 1. Ouvrir la démonstration locale

Depuis la racine du projet, dans un terminal PowerShell :

```powershell
npm.cmd run demo:api
```

Ouvrir **http://localhost:3001/api-docs/**. Le titre doit annoncer **DEMO LOCALE — DONNEES FICTIVES**. Si le serveur est déjà démarré sur ce port, ouvrir simplement l’adresse. Laisser son terminal actif ; `Ctrl+C` l’arrête.

Ce mode utilise les mêmes routes, services et requêtes SQL que l’API. Il charge des données fictives dans PostgreSQL embarqué PGlite, uniquement en mémoire, puis injecte cet accès à la base dans l’application Fastify. Il réutilise les fixtures des tests automatisés. Aucun téléchargement NASA ni accès à une base Docker n’est effectué. Il nécessite les dépendances de développement installées avec `npm ci`.

L’API habituelle reste sur le port **3000**, avec PostgreSQL configuré par `.env`. Le mode démo utilise **3001**. En démo, le header `X-Firebridge-Demo: synthetic-data` identifie les réponses. Les données et le secret de curseurs sont recréés à chaque lancement ; un curseur d’une ancienne session sera rejeté.

## 2. Comment utiliser Swagger

Pour chaque route dans le groupe **Phase 1** :

1. Cliquer sur la route.
2. Cliquer sur **Try it out**.
3. Renseigner les paramètres indiqués ci-dessous ; laisser les paramètres facultatifs inutilisés vides.
4. Cliquer sur **Execute**.
5. Vérifier le **code HTTP** et le JSON dans **Response body**.

Le champ extérieur `request_id` change à chaque requête. Les résultats métier se trouvent dans `data`. Une erreur prévue possède `data: null` et un objet `error` avec un code explicite.

Swagger peut afficher **Undocumented** à côté d’une erreur lorsque son schéma de réponse n’est pas détaillé dans OpenAPI. Pour ces cas, vérifier le code HTTP et `error.code` ci-dessous : une erreur attendue fait partie d’un test réussi.

## 3. Les identifiants du jeu fictif

| Élément                     | Valeur à utiliser                      |
| --------------------------- | -------------------------------------- |
| Scope de démonstration      | `morocco`                              |
| Alias courant               | `latest_standard`                      |
| Ancienne release publiée    | `11111111-1111-4111-8111-111111111111` |
| Release courante publiée    | `22222222-2222-4222-8222-222222222222` |
| Release encore en brouillon | `44444444-4444-4444-8444-444444444444` |

Ces valeurs sont disponibles dans la démo et les tests, pas automatiquement dans la base réelle de l’équipe.

## 4. Tester GET /catalog

### Cas A : catalogue disponible

Renseigner `scope_key=morocco` puis exécuter.

**Attendu : `200`.** Dans `data` :

- `scope_key` vaut `morocco`.
- `release_aliases` contient `latest_standard` avec la release `22222222-2222-4222-8222-222222222222`.
- `sources` contient `terra`, `aqua` et `noaa21`.
- `metrics` contient `native_detections_v1` ; la métrique harmonisée non publiée n’est pas annoncée.
- Pour `noaa21`, `availability_status` reste `unknown` et les intervalles locaux sont vides : son feed fictif n’est pas vérifié.

### Cas B : scope inconnu

Remplacer `scope_key` par `inconnu`.

**Attendu : `404`**, avec `error.code=UNKNOWN_SCOPE`.

### Cas C : scope par défaut

Ne pas fournir `scope_key`.

**Attendu : `200`**, avec `data.scope_key=morocco`.

URL directe du cas A : http://localhost:3001/api/v1/catalog?scope_key=morocco

## 5. Tester GET /releases/{release_id}

### Cas A : version publiée

Renseigner :

```text
release_id = 22222222-2222-4222-8222-222222222222
membership = partitions
limit = 50
```

**Attendu : `200`.** Vérifier :

- `data.id` correspond à l’UUID demandé.
- `data.parent_release_id` vaut `11111111-1111-4111-8111-111111111111`.
- `data.partition_counts` annonce 3 partitions de détections et `row_count="10"`.
- `data.membership.returned` vaut `3` et `next_cursor` est `null`.
- Aucun chemin `s3://...`, aucune configuration brute et aucune clé fournisseur ne sont exposés.

Le jeu contient volontairement une partition dont les tables de service sont incomplètes. `serving_complete=false` doit rester visible. Cela n’est pas une erreur du test.

### Cas B : pagination

Garder la même release et `membership`, puis passer `limit` à `1`.

**Attendu : `200`**, avec un membre, `returned=1` et un `next_cursor` non nul.

Copier uniquement la valeur du curseur, sans les guillemets JSON, dans le champ `cursor`. Garder `limit=1`, puis exécuter. Répéter avec le nouveau curseur pour atteindre la troisième page.

**Attendu :** trois pages avec des `partition_id` différents ; le curseur devient `null` à la dernière page.

Pour un test d’erreur, conserver le premier curseur et changer `limit` à `2`.

**Attendu : `422`**, avec `error.code=INVALID_CURSOR`, car le curseur est lié à la taille de page.

### Cas C : fichiers d’entrée

Vider `cursor`, remettre `limit=50` et choisir `membership=assets`.

**Attendu : `200`**, avec un fichier d’entrée. Ses champs comprennent `source_id=terra`, `role=raw` et `byte_size="42"`.

### Cas D : release non publiée

Remplacer `release_id` par `44444444-4444-4444-8444-444444444444`, sans curseur.

**Attendu : `404`**, avec `error.code=RELEASE_NOT_FOUND`. Un brouillon n’est pas public.

### Cas E : identifiant mal formé

Essayer `release_id=abc`.

**Attendu : `422`**, avec `error.code=INVALID_REQUEST`.

Swagger peut également bloquer la saisie invalide avant de l’envoyer. Pour forcer l’appel HTTP, ouvrir : http://localhost:3001/api/v1/releases/abc

## 6. Tester GET /updates

### Cas A : une autre version est disponible

Renseigner :

```text
scope_key = morocco
alias = latest_standard
after_release_id = 11111111-1111-4111-8111-111111111111
```

Laisser `component` vide, ou choisir `satellite`.

**Attendu : `200`.** Vérifier :

- `data.has_updates=true`.
- `data.current` pointe vers `22222222-2222-4222-8222-222222222222`.
- `data.comparison=compared` et `data.history_complete=true`.
- `data.changes` contient la raison `provider_revision`.

Les deux versions du jeu fictif ont le même total de lignes. L’API détecte tout de même le changement, car elle compare les UUIDs.

### Cas B : déjà à jour

Remplacer uniquement `after_release_id` par `22222222-2222-4222-8222-222222222222`.

**Attendu : `200`**, avec `has_updates=false` et `changes=[]`.

### Cas C : première consultation

Vider `after_release_id` en conservant le scope et l’alias.

**Attendu : `200`**, avec `comparison=baseline_not_provided`, `has_updates=false` et `changes=[]`. Le client reçoit les versions courantes, sans comparaison avec une ancienne version.

### Cas D : filtre inexistant

Essayer `alias=inconnu` avec `scope_key=morocco`.

**Attendu : `422`**, avec `error.code=UNKNOWN_RELEASE_FILTER`.

## 7. Quand considérer ta recette manuelle réussie ?

| Vérification                                                | À cocher |
| ----------------------------------------------------------- | -------- |
| Catalogue disponible, aliases et valeurs inconnues corrects | ☐        |
| Scope inconnu rejeté                                        | ☐        |
| Détail d’une release publiée correct                        | ☐        |
| Pagination sans doublons jusqu’à la dernière page           | ☐        |
| Curseur incompatible rejeté                                 | ☐        |
| Fichiers d’entrée consultables sans chemins privés          | ☐        |
| Release brouillon et UUID invalide rejetés                  | ☐        |
| Mise à jour détectée pour l’ancienne release                | ☐        |
| Aucune mise à jour pour la release courante                 | ☐        |
| Première consultation et filtre invalide correctement gérés | ☐        |

Tu peux considérer le parcours manuel de métadonnées validé **pour ce jeu fictif** si les résultats correspondent. Les tests automatisés complètent cette vérification, notamment pour les ETags, les transactions en lecture seule et les historiques intermédiaires.

## 8. Ce qu’il faudra vérifier avec la base réelle

La démo ne valide ni les migrations de ton collègue, ni PostGIS réel, ni une ingestion NASA. Elle adapte les types géométriques pour les tests de métadonnées et ne fournit aucune preuve scientifique.

Après livraison des migrations et d’un petit jeu réel publié :

1. Démarrer PostgreSQL et appliquer les migrations de l’équipe.
2. Configurer `.env`, puis démarrer l’API habituelle avec `npm.cmd run dev:api`.
3. Ouvrir http://localhost:3000/api-docs/.
4. Rejouer les cas avec les scopes, sources, UUIDs et aliases de la vraie base.
5. Comparer le contenu renvoyé aux métadonnées réellement publiées.

Les deux recettes répondent à des questions complémentaires : la démo vérifie les parcours HTTP/SQL sur un jeu connu ; la recette réelle vérifie leur intégration avec le travail de l’équipe.
