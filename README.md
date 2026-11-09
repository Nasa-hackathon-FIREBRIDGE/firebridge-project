# FIREBRIDGE

Version d'intégration de l'équipe, destinée au raccordement au pipeline de données.

```text
firebridge-backend/    API Fastify, worker, contrats et base de données
firebridge-frontend/   Application React et intégration HTTP
```

Les deux applications sont incluses dans un seul clone de la branche `staging`.
Les rapports de travail restent consultables sur les branches de développement.
Les tests automatisés et la CI restent dans le dépôt pour la maintenance ;
les fichiers de tests et les Markdown du projet sont exclus des contextes Docker.

## Construction Docker

Depuis `firebridge-backend`, préparer un fichier `.env` privé à partir de
`.env.example`, puis renseigner les secrets et les URL du déploiement :

```bash
docker compose config --quiet
docker compose build api worker frontend
```

Le Compose fourni décrit l'environnement de développement. Le démarrage sur
le VPS doit utiliser la configuration et les réseaux prévus pour la base existante.

## Raccordement aux données réelles

- Référence : `docs/data/NODE_HANDOFF.md` du dépôt
  [FireBridge-data-pipeline](https://github.com/Nasa-hackathon-FIREBRIDGE/FireBridge-data-pipeline).
- Vérifier la correspondance des vues `serving` du pipeline avec les repositories
  du backend, ainsi que les droits de lecture et d'écriture applicatifs.
- Coordonner les migrations avec le responsable data avant toute application
  sur sa base. Le compte de lecture du pipeline ne suffit pas pour écrire les
  zones, analyses et tâches de l'application.
- Configurer `DOCKER_DATABASE_URL`, `DOCKER_REDIS_URL`, `DEFAULT_SCOPE_KEY`,
  `FRONTEND_API_URL` et `CORS_ORIGINS` pour le serveur. Les secrets restent dans
  les `.env` privés ; les URL frontend sont publiques et fixées au build.
- Pour la production, utiliser `deploy/compose.production.yaml` et les variables
  privées de `/opt/firebridge/webapp/runtime.env` ; voir [deploy/README.md](deploy/README.md).
  Le Compose de développement ne doit pas remplacer la stack data existante.

Les images API, worker et frontend ont été construites dans cette structure.
Les dépendances ont été actualisées avant exposition publique : les audits npm de
production backend et frontend ne signalent aucune vulnérabilité au 8 novembre 2026.
Six alertes modérées restent dans les outils de développement backend ; aucune
alerte élevée ou critique n'est acceptée par la CI.

## Production Contabo

- Site : https://astramind.solutions ; API : `/api/v1`.
- La branche `staging` est déployée après validation par `.github/workflows/webapp.yml`.
- Configuration, réseau privé, compte SQL limité et fonctionnement CI/CD :
  [deploy/README.md](deploy/README.md).
- Les images sont construites/testées en CI, puis transférées par un compte SSH
  dédié. Aucun secret serveur ne fait partie des images ou du dépôt.
- La base de données et les pipelines existants restent dans leur propre stack.
