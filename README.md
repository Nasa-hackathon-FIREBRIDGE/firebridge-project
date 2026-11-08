# FIREBRIDGE — intégration staging

Cette branche rassemble le travail frontend et backend de l'équipe. Elle sert
à préparer et valider leur intégration avec le pipeline de données.

```text
firebridge-project/
├── firebridge-backend/     # Fastify, API, worker, contrats et accès aux données
├── firebridge-frontend/    # React, interface et services HTTP
└── .github/workflows/     # Vérifications exécutées depuis cette structure
```

Les deux dossiers conservent les noms attendus par les dépendances locales et
les contextes de construction Docker. Le code est regroupé dans un seul clone ;
deux clones ni deux worktrees ne sont nécessaires sur le serveur.

Les informations de lancement et de connexion au pipeline seront documentées
dans `docs/STAGING_HANDOFF.md`.
