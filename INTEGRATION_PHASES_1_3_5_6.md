# Intégration frontend des phases 1, 3, 5 et 6

Le frontend consulte le backend Fastify via HTTP. Le catalogue avait déjà été connecté.
Cette livraison ajoute les 19 autres opérations ci-dessous.
Les 20 endpoints des phases 1, 3, 5 et 6 disposent maintenant de leur liaison frontend.

## Écrans disponibles

| Adresse frontend | Usage |
| --- | --- |
| /evidence | Catalogue, détail des versions, mises à jour et disponibilité d’une source |
| /api-analysis | Ouvrir une analyse existante, consulter ses résultats, demander et lire une synthèse |
| /ingestion | Opérations d’ingestion protégées par le jeton d’administration |

Les pages de carte et les graphiques de démonstration existants continuent à utiliser
leurs fixtures locales. Les nouveaux panneaux affichent les réponses de l’API ;
cela ne transforme pas des données de test en observations NASA réelles.
La base choisie par le backend détermine les données accessibles.

## Chemin d’une requête

Composant → hook React Query → service → instance Axios → Fastify → service backend
→ repository → PostgreSQL/PostGIS. La réponse revient ensuite vers le composant.

Exemple : ouvrir l’onglet Météo monte WeatherPanel, qui appelle useWeather.
Le hook fournit une clé de cache et un signal d’annulation au service context.weather.
Ce service appelle GET /analyses/{id}/weather avec Axios.
Le panneau affiche les mesures reçues, leurs unités, leur origine et leurs limites.

Aucun fetch HTTP n’est placé dans un useEffect.
L’effet de IngestionPage sert uniquement à nettoyer la session temporaire au départ
de l’écran : annuler les requêtes et supprimer les résultats d’administration en cache.

| Dossier / fichier | Responsabilité |
| --- | --- |
| src/lib/axios.ts | Client HTTP commun et normalisation des erreurs, déjà présents |
| src/lib/queryClient.ts | Cache React Query commun, déjà présent |
| src/services/data.types.ts | Types des échanges des nouvelles opérations ; nombres longs conservés en chaînes |
| src/services/resource.ts | Lecture de l’enveloppe API, conservation des avertissements et de l’identifiant de requête |
| src/services/*.service.ts | URLs, paramètres HTTP, corps et en-têtes |
| src/hooks/useDataApi.ts | Requêtes publiques, création et lecture d’une explication |
| src/hooks/useIngestion.ts | Requêtes et mutations de la session d’administration |
| src/hooks/useIntentKey.ts | Réutilisation de la clé d’idempotence lorsque le formulaire est renvoyé sans changement |
| src/hooks/useCursorPage.ts | Historique de pagination précédent/suivant |
| src/components/api | Présentation des résultats, filtres, erreurs, valeurs inconnues et limites |
| src/components/api/ExplanationResult.tsx | Lecture de l’état d’une explication et affichage de son résultat |
| src/pages/ApiAnalysisPage.tsx | Sélection d’analyse et onglets ; seule la vue ouverte charge ses résultats |
| src/pages/IngestionPage.tsx | Session temporaire, consultation et formulaires de planification |

Les nouveaux DTO restent dans le frontend. Le paquet partagé @firebridge/contracts
existant est réutilisé pour l’enveloppe et les opérations déjà intégrées par Zakaria.
Aucune migration ni modification du backend n’est nécessaire pour cette livraison.

## Opérations ajoutées

Tous les chemins ci-dessous ont le préfixe backend /api/v1.

| Phase | Méthode | Chemin | Service |
| --- | --- | --- | --- |
| 1 | GET | /releases/{release_id} | releases.get |
| 1 | GET | /updates | releases.updates |
| 3 | GET | /analyses/{id}/detections | nativeResults.detections |
| 3 | GET | /analyses/{id}/summary | nativeResults.summary |
| 3 | GET | /analyses/{id}/calendar | nativeResults.calendar |
| 3 | GET | /analyses/{id}/provenance | nativeResults.provenance |
| 5 | GET | /sources/{source_id}/availability | ingestion.availability |
| 5 | GET | /admin/ingestion/subscriptions | ingestion.subscriptions |
| 5 | GET | /admin/ingestion/gaps | ingestion.gaps |
| 5 | GET | /admin/ingestion/runs/{id} | ingestion.run |
| 5 | POST | /admin/ingestion/backfills | ingestion.backfill |
| 5 | POST | /admin/ingestion/subscriptions/{id}/refresh | ingestion.refresh |
| 6 | GET | /analyses/{id}/coverage | context.coverage |
| 6 | GET | /analyses/{id}/cells/{cell_id} | context.cell |
| 6 | GET | /analyses/{id}/comparison | context.comparison |
| 6 | GET | /analyses/{id}/weather | context.weather |
| 6 | GET | /analyses/{id}/reports | context.reports |
| 6 | POST | /analyses/{id}/explanations | explanations.create |
| 6 | GET | /explanations/{id} | explanations.get |

GET /catalog conserve le service, le hook et le composant créés manuellement auparavant.
GET /explanations/{id} est connecté au service explanations.get,
au hook useExplanation et au composant ExplanationResult.
Le frontend consulte l’état puis affiche le résultat validé ou template_fallback.

## Cache, pagination et écritures

Les clés des lectures incluent l’analyse ou la version, la ressource et tous ses
filtres, y compris le curseur. Deux analyses ou deux pages différentes ne partagent
donc pas accidentellement leurs résultats. React Query réutilise les requêtes identiques.
Les signaux d’annulation sont transmis jusqu’à Axios.

Changer les filtres ou l’analyse remonte la vue paginée sur sa première page.
Le curseur signé est réutilisé uniquement avec la sélection qui l’a produit.
Les boutons précédent/suivant parcourent les pages ; ils ne prétendent pas charger
tous les enregistrements d’un seul appel.

Les POST utilisent useMutation. Une clé d’idempotence UUID accompagne la demande :
après un échec réseau, renvoyer le même formulaire réutilise cette clé.
Changer le contenu crée une nouvelle intention et une nouvelle clé.
Aucune mutation n’est automatiquement répétée après une erreur.

## Administration sans compte utilisateur

Les lectures publiques n’envoient pas de jeton.
L’écran /ingestion demande explicitement le jeton technique INGESTION_ADMIN_TOKEN,
qui doit correspondre à celui du backend. Le saisir dans le champ prévu ; ne jamais
l’ajouter à .env.local, à une variable VITE_, au code ou à Git.

Le jeton est transmis dans Authorization: Bearer uniquement sur les cinq opérations
d’administration. Il reste dans l’état mémoire de cette page ; aucun stockage navigateur
ni cookie d’authentification n’est utilisé. Les clés de cache contiennent un identifiant
de session aléatoire, jamais le secret. Fermer ou quitter cette session annule ses
requêtes et supprime ses résultats en cache. Les mutations ont une rétention nulle
une fois qu’elles ne sont plus observées.

Une réponse 401 signifie que le jeton manque ou ne correspond pas.
Une réponse 503 peut signifier que le backend n’a pas configuré cet accès.
L’affichage d’un champ de jeton ne remplace pas le contrôle effectué par Fastify.

## Limites conservées dans l’interface

- null reste « Inconnu / non disponible » et n’est jamais transformé en zéro.
- Les identifiants bigint restent des chaînes ; les heures avec microsecondes ne sont pas arrondies.
- Les détections ne sont pas présentées comme un nombre d’incendies uniques.
- Les états partial, missing et unsupported restent visibles avec leurs motifs.
- Les mesures météo gardent leurs unités et ne deviennent pas une moyenne de zone.
- Les rapports candidats ou non révisés ne constituent pas une confirmation.
- L’ingestion est une planification uniquement. Aucun téléchargement NASA n’est exécuté
  par ces formulaires et aucune publication automatique n’est annoncée.
- Les budgets d’ingestion sont enregistrés ; la consommation réelle n’est pas encore mesurée.
- Les explications sont des modèles factuels déterministes, sans fournisseur d’IA externe.
  Leur exécution demande le worker. Le frontend lit l’état et le résultat
  avec GET /explanations/{id}.

## Vérification locale

Conserver deux terminaux ouverts : API dans firebridge-backend et Vite dans firebridge-frontend.
PostgreSQL et Redis doivent être lancés. Le worker est nécessaire pour les nouvelles
analyses et les explications, pas pour consulter les résultats déjà préparés.

Depuis le frontend :

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run lint
```

Les nouveaux tests unitaires vérifient les chemins canoniques, l’isolation des en-têtes
d’administration, les avertissements, les valeurs inconnues, le cache, la pagination,
les reprises idempotentes et les écrans.

La suite HTTP supplémentaire est facultative et écrit uniquement des demandes
de test. Elle exige que le backend soit configuré sur la base locale
firebridge_phase1_test, sur le port 3000, avec les fixtures phase1_test existantes.
Elle refuse de continuer si le catalogue ne possède pas l’empreinte attendue.
Elle lit le jeton de configuration côté processus de test, jamais côté bundle Vite.

```powershell
$env:FIREBRIDGE_DATA_SMOKE = '1'
try {
  npx.cmd vitest run src/services/data-api.live.test.ts
  $testExitCode = $LASTEXITCODE
} finally {
  Remove-Item Env:\FIREBRIDGE_DATA_SMOKE -ErrorAction SilentlyContinue
}
if ($testExitCode -ne 0) { throw "Les tests HTTP ont échoué." }
```

Cette suite crée des demandes d’import/actualisation et d’explication dans la base
synthétique, sans lancer de téléchargement fournisseur et sans vider la base.
Elle teste aussi le rejeu d’une demande avec la même clé.

Dans la base locale actuelle, ces identifiants servent uniquement aux essais :

| Donnée de test | Identifiant |
| --- | --- |
| Analyse native avec contexte météo/rapports | a3000000-0000-4000-8000-000000000001 |
| Analyse scientifique préparée | 60000000-0000-4000-8000-000000000100 |
| Cellule de l’analyse préparée | 6001 |
| Zone enregistrée | aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa |
| Souscription | bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb |
| Tentative de collecte vide confirmée | f5000000-0000-4000-8000-000000000001 |

La comparaison common_response de l’analyse préparée existe à la résolution month.
À la résolution week, unsupported est une réponse attendue, pas une panne HTTP.

## Lecture du résultat d’une explication

Le POST crée la demande et renvoie explanation_id.
ExplanationResult utilise cet identifiant avec le hook useExplanation.
Le hook appelle explanations.get et actualise la lecture toutes les deux secondes
tant que l’état est queued ou running. Cette actualisation périodique s’arrête
sur un état final ou une erreur.

Le composant affiche l’attente, les erreurs, puis le résultat validé
ou template_fallback. La génération utilise un modèle factuel déterministe.
La lecture GET permet de récupérer le résultat enregistré par le worker
après la réponse initiale du POST.

Le parcours a été vérifié manuellement dans le navigateur sur les données synthétiques.
Les tests des écrans, des services et les six tests HTTP locaux passent.

