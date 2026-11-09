# FIREBRIDGE frontend

Application React/TypeScript, construite avec Vite et servie par Nginx dans Docker.

- `src/pages` et `src/features` : écrans et fonctionnalités.
- `src/hooks` : accès aux données avec TanStack Query.
- `src/services` : appels HTTP Axios vers l'API Fastify.
- `src/components` : composants partagés et carte MapLibre.
- `src/features/demo` : écrans synthétiques chargés à la demande.
- `src/styles/legacy` : styles historiques, avec ordre de cascade conservé.
- `src/App.tsx` : fournisseurs globaux et routes ; aucune récupération de données métier.

Le package `@firebridge/contracts` est fourni par
`../firebridge-backend/packages/contracts`. Conserver ces noms de dossiers.
Voir le [README principal](../README.md) pour la construction Docker et la
configuration de l'API. Les `.env` privés ne sont pas inclus dans le dépôt.

Les tests navigateur se lancent avec `npm run test:e2e`. Ils nécessitent une API
de test sur `127.0.0.1:3301`, son worker et les fixtures `phase1_test` portant
une version `TEST ONLY`. Le lanceur vérifie cette empreinte avant toute écriture,
compile le frontend puis exécute Playwright sur le port 5174. Les résultats,
captures et traces restent dans `.qa/e2e`, exclu de Git et des images Docker.
