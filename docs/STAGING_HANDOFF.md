# Livraison staging — frontend, backend et connexion data

## Contenu intégré

Cette livraison reprend intégralement les versions publiées suivantes :

| Dossier | Branche source | Commit source |
| --- | --- | --- |
| `firebridge-backend` | `feat/anwar-backend` | `8069af9` |
| `firebridge-frontend` | `feat/anwar-frontend` | `df00a64` |

Le backend inclut `zakaria/fastify-phase-2` au commit `2d4667d`.
Le frontend inclut `zakaria/zakaria_frontend` au commit `0fbc949`.
Les intégrations utilisent `git subtree add` sans squash : les historiques des
deux composants et les commits des contributeurs sont conservés.

Les fichiers proviennent des arbres Git suivis, pas d'une copie des dossiers
locaux : `.env`, `node_modules`, `dist`, documents personnels, téléchargements
et données synthétiques non suivies ne sont pas livrés. Les fixtures et les
tests suivis restent disponibles dans le code ; aucun script de peuplement
n'est lancé par cette intégration.

## Récupérer cette livraison

Pour une nouvelle installation :

```bash
git clone --branch staging --single-branch https://github.com/Nasa-hackathon-FIREBRIDGE/firebridge-project.git
cd firebridge-project
```

Il s'agit d'un seul dépôt contenant deux dossiers, sans sous-modules Git. Les
branches personnelles conservent leur organisation actuelle et ne sont pas
déplacées par la préparation de staging.

Pour une mise à jour d'un clone déjà sur staging, vérifier `git status`, puis
utiliser `git pull --ff-only origin staging` si le dossier de travail est propre.

## Vérifier et construire

Installation sans Docker, depuis la racine du dépôt :

```bash
cd firebridge-backend
npm ci
npm run build --workspace @firebridge/contracts
cd ../firebridge-frontend
npm ci
npm run lint
npm run build
```

Les vérifications GitHub sont dans `.github/workflows/ci.yml`, à la racine.
Les commandes backend s'exécutent dans `firebridge-backend` ; les commandes
frontend s'exécutent dans `firebridge-frontend`. Les anciens workflows présents
dans le sous-dossier backend ne sont pas des workflows actifs à la racine.

Docker Compose s'utilise depuis `firebridge-backend`. Préparer un `.env` privé à
partir de `.env.example`, renseigner les secrets et les URL du déploiement, puis :

```bash
docker compose config --quiet
docker compose build api worker frontend
```

Le Compose fourni décrit la pile de développement à cinq services. Sa commande
`up` lance aussi PostgreSQL local ; elle ne constitue pas une migration vers la
base du pipeline. Sur le VPS, le responsable du déploiement doit choisir le
réseau et la configuration adaptés à la base existante avant le démarrage.

## Contrat de connexion avec le pipeline

Le dépôt data est :
https://github.com/Nasa-hackathon-FIREBRIDGE/FireBridge-data-pipeline

La référence d'intégration est son fichier `docs/data/NODE_HANDOFF.md`.
Le pipeline propose des vues en lecture dans le schéma `serving`, notamment
`sources`, `latest_releases`, `releases`, `partitions` et `detections`.

Le backend livré utilise actuellement des requêtes sur le schéma `firebridge`
et écrit ses propres zones, analyses, jobs et événements d'outbox. La présence
des deux applications dans staging ne prouve donc pas encore leur compatibilité
avec les migrations et les droits installés sur le VPS.

Le passage aux données réelles nécessite de vérifier ensemble :

1. Le schéma installé et la correspondance entre les vues `serving` et les
   requêtes des repositories de l'API.
2. Les droits de lecture des données et les droits d'écriture applicatifs.
   Le compte `firebridge_reader` du pipeline ne suffit pas pour créer analyses,
   zones, tâches ou demandes d'ingestion.
3. La propriété des migrations et le plan de sauvegarde avant toute migration
   applicative. Ne pas exécuter les migrations Prisma sur la base du pipeline
   avant d'avoir vérifié leur compatibilité.
4. Les périmètres réellement publiés et le choix de `DEFAULT_SCOPE_KEY`.
   `phase1_test` est une configuration de démonstration, pas le périmètre réel.
5. `DOCKER_DATABASE_URL`, le réseau Docker ou l'accès PostgreSQL du serveur,
   `DOCKER_REDIS_URL` et les secrets d'administration et de pagination.
6. `FRONTEND_API_URL` pour l'URL publique de l'API au moment du build, ainsi que
   `CORS_ORIGINS`, le nom de domaine, HTTPS et le reverse proxy du VPS.
   `localhost` dans le navigateur désigne le poste du visiteur.

Aucun accès au VPS, changement de base ou téléchargement NASA n'a été effectué
pour préparer cette livraison. Les contrôles utilisateur des fonctionnalités
restent à réaliser avec l'équipe sur les données réelles après raccordement.

## Vérifications de la livraison du 8 novembre 2026

Les arbres Git des deux dossiers ont été comparés aux commits sources : leur
contenu est identique. Les quatre branches des deux contributeurs figurent dans
l'historique de staging. Les fichiers privés et les artefacts locaux sont exclus.
Les chemins de travail et de lockfiles du workflow GitHub ont été vérifiés.

La configuration Compose a été validée et la construction des images API,
worker et frontend est vérifiée séparément sous le projet Docker
`firebridge-staging-review`, sans lancement de conteneurs ni migration de base.
Les tests fonctionnels restent manuels, conformément à l'organisation de l'équipe.
Le résultat des jobs GitHub est à consulter après le push de cette branche.

La construction a signalé des dépendances backend à mettre à jour : npm audit
rapporte 20 alertes au total, dont deux critiques, en incluant les dépendances
de développement. Une lecture séparée avec `npm audit --omit=dev --json`
rapporte six alertes de production : trois modérées et trois élevées, aucune
critique. Les paquets signalés sont `@fastify/static`, `@prisma/config`,
`deepmerge-ts`, `glob`, `minimatch` et `prisma` (certaines alertes sont liées entre
elles). Le frontend installé séparément n'a pas d'alerte signalée à cette date.

La mise à jour et sa validation sont à planifier avant l'exposition publique sur
le VPS. Les images backend installent actuellement aussi les dépendances de
développement. Aucune mise à jour automatique ni commande `audit fix --force`
n'a été appliquée pendant le regroupement des versions de l'équipe.

## Intégrer les prochains avancements

Depuis un clone de staging propre, actualiser les références, vérifier les
commits sources avec l'équipe, puis intégrer les composants explicitement :

```bash
git fetch origin
git subtree merge --prefix=firebridge-backend origin/feat/anwar-backend
git subtree merge --prefix=firebridge-frontend origin/feat/anwar-frontend
```

Ces commandes concernent la structure regroupée de staging. Un merge classique
des branches à la racine ne préserve pas cette répartition des dossiers.
Examiner les conflits éventuels et les vérifications CI avant le push. Les
adaptations communes au déploiement sont documentées et revues dans staging.
