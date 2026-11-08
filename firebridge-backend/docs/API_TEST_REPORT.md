# Rapport de tests FIREBRIDGE

> Historical report from the Phase 4 branch. For the merged implementation, current fixture v2, actual identity behavior and fresh validation, see [integration report](PHASE_4_REVIEW.md).

Exécution du 2026-10-31T05:05:32.411Z au 2026-10-31T05:09:25.272Z (UTC). Résultat : **BLOCKED**.

Les services existants sur le port 3000 ont été conservés conformément au refus de remplacement. Les requêtes réelles ci-dessous ciblent les conteneurs distincts sur **127.0.0.1:3104**.

## Préservation

Sauvegarde custom vérifiée : SHA-256 `d622d4d5a464351c38cd8d4d8bb2e67236c8951d9b219867f5b8a7bad32b96cd`. Restauration complète dans `firebridge_backup_20261031_050532_test`, puis comparaison des 48 tables métier.
Comparaison finale des données historiques : **non exécutée**.
IDs et images des quatre conteneurs historiques inchangés : **non vérifié**.
Aucun reset, DROP, TRUNCATE, suppression de ligne métier ou changement du .env réel.

## Commandes exécutées

| Commande | Sortie | Log |
|---|---:|---|
| npm run build | 0 | .data/audit/build.log |
| npm run typecheck | 0 | .data/audit/typecheck.log |
| npm run lint | 0 | .data/audit/lint.log |
| npm test | 0 | .data/audit/unit-tests.log |
| npm run seed:phase4 -- --apply --confirm-database firebridge_phase4_test | 0 | .data/audit/fixture.log |
| npm run test:integration | 0 | .data/audit/integration-final.log |
| npm run seed:phase4 -- --apply --confirm-database firebridge_phase4_test --queue-exports --export-run audit_20261031_050532 | 1 | .data/audit/fixture-exports.log |

Dernier passage unitaire API puis worker : **Tests [22m [1m[32m242 passed[39m[22m[90m (242)[39m ; Tests [22m [1m[32m41 passed[39m[22m[90m (41)[39m**.
Dernier passage avec intégration API puis worker : **Tests [22m [1m[32m260 passed[39m[22m[90m (260)[39m ; Tests [22m [1m[32m54 passed[39m[22m[90m (54)[39m**.

Les totaux d’intégration incluent les tests habituels. Les logs détaillent chaque fichier et durée. La construction Docker et les healthchecks sont conservés dans `.data/audit/docker-build-final.log` et `docker-audit-start.log`.

## HTTP réel et assertions de contenu

| Cas et endpoint | Méthode | Attendu | Réel | MIME | ms | Résumé réponse | Vérification SQL/cache/fichier | Résultat |
|---|---|---:|---:|---|---:|---|---|---|

**0/0 cas HTTP réussis.** Un PASS exige le statut attendu et toutes les assertions du cas.

Les MVT sont décodés : 256 détections sur la tuile mondiale, 64 dans chacune des quatre tuiles zoom 8, zéro dans la tuile vide. Les trois téléchargements sont parsés et comparés aux 256 lignes du manifeste, y compris identifiants, coordonnées, dates, filtres de sélection et protection CSV. Taille et SHA-256 sont comparés aux métadonnées SQL. Cette phrase décrit les assertions prévues ; le tableau reste la preuve de leur résultat effectif.

## Mesures


Mesures locales sur des fixtures conservées ; la variation RSS ne constitue pas une mesure du pic absolu ni une qualification de charge de production. Le test concurrent vérifie aussi que liveness répond pendant les exports.

## Historique et limites

- Les premières validations ont révélé l’image obsolète, le GROUP BY SQL invalide et deux IDs fictifs non UUID dans des tests anciens. Ils ont été corrigés ; la validation UUID n’a pas été relâchée.
- Un premier passage complet d’intégration a donné 256 tests API réussis puis 49 tests worker réussis et 3 échecs (timeouts/concurrence). L’isolation des fixtures, le scope outbox et la sérialisation des fichiers d’intégration ont été corrigés. Le test MVT laisse désormais une marge au timeout SQL ; les limites runtime restent actives. Les résultats finaux figurent ci-dessus.
- Les tests BullMQ provoquent de vraies erreurs de stockage : succès après retry et état failed après trois tentatives. Les tests de lease, replay et outbox complètent ces scénarios.
- Le premier smoke réel a révélé un 409 incorrect au replay : la fermeture normale de la connexion finalisait prématurément l’état d’idempotence avant onResponse. Le hook a été corrigé et un test sur une vraie connexion HTTP a été ajouté.
- L’image historique sur localhost:3000 reste obsolète : le remplacement a été explicitement refusé. Aucun succès de l’API corrigée n’est revendiqué sur ce port.
- Le déploiement normal requiert un fournisseur d’identité de confiance ; les credentials opaques de test sont refusés hors mode isolé. Les analyses historiques anonymes ne sont pas réattribuées.
- Les 24 routes planifiées restent 501 ; leur PASS vérifie ce contrat et n’implique aucune fonctionnalité métier.
- La rétention du worker de test est de 180 secondes ; l’expiration est naturelle. Aucun test d’URL signée n’est requis : stockage local partagé et streaming uniquement.
- Les données de test et bases de restauration sont conservées. Le nettoyage automatique porte sur les seuls fichiers d’export dédiés expirés.
- Les avertissements de dépréciation Fastify/outillage et les vulnérabilités npm existantes n’ont pas été masqués ou corrigés par une mise à jour globale.

Blocage de cette exécution : npm run seed:phase4 -- --apply --confirm-database firebridge_phase4_test --queue-exports --export-run audit_20261031_050532 failed (1). See .data/audit/fixture-exports.log

Procédure et commandes curl : [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md). Données et dépendances : [TEST_FIXTURES.md](TEST_FIXTURES.md). Audit : [API_AUDIT.md](API_AUDIT.md).
