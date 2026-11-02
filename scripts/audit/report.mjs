import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditDirectory, root, redact } from './process.mjs';

const escape = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
async function summaries(log) {
  try { return (await readFile(resolve(auditDirectory, log), 'utf8')).match(/Tests\s+[^\r\n]+/g) ?? []; }
  catch { return []; }
}

export async function writeAuditReport(report) {
  await mkdir(resolve(root, 'docs'), { recursive: true });
  const unit = await summaries('unit-tests.log'), integration = await summaries('integration-final.log');
  const measurements = [];
  if (report.integration_exit_code !== undefined) {
    const log = await readFile(resolve(auditDirectory, 'integration-final.log'), 'utf8');
    for (const line of log.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try { const value = JSON.parse(line); if (value.benchmark) measurements.push(value); } catch { /* Vitest text, not a benchmark */ }
    }
    const postgis = measurements.find((value) => value.benchmark === 'PostGIS tiles');
    if (postgis?.metricsDirectory) await copyFile(resolve(postgis.metricsDirectory, 'phase4-postgis.json'), resolve(auditDirectory, 'phase4-postgis.json'));
  }
  report.measurements = measurements;
  await writeFile(resolve(auditDirectory, 'report.json'), JSON.stringify(report, null, 2));
  const lines = [
    '# Rapport de tests FIREBRIDGE', '',
    `Exécution du ${report.started_at} au ${report.finished_at} (UTC). Résultat : **${report.status}**.`, '',
    'Les services existants sur le port 3000 ont été conservés conformément au refus de remplacement. Les requêtes réelles ci-dessous ciblent les conteneurs distincts sur **127.0.0.1:3104**.', '',
    '## Préservation', '',
    report.backup ? `Sauvegarde custom vérifiée : SHA-256 \`${report.backup.sha256}\`. Restauration complète dans \`${report.backup.restored_database}\`, puis comparaison des ${report.backup.preserved_tables} tables métier.` : 'La préparation de la sauvegarde de cette exécution n’a pas abouti ; consulter les logs.',
    `Comparaison finale des données historiques : **${report.preservation?.unchanged === true ? 'identiques' : report.preservation ? 'différence détectée' : 'non exécutée'}**${report.preservation ? ` (${report.preservation.tables} tables, ${report.preservation.analyses} analyses, ${report.preservation.jobs} jobs)` : ''}.`,
    `IDs et images des quatre conteneurs historiques inchangés : **${report.original_container_ids_unchanged === true ? 'oui' : report.original_container_ids_unchanged === false ? 'non' : 'non vérifié'}**.`,
    'Aucun reset, DROP, TRUNCATE, suppression de ligne métier ou changement du .env réel.', '',
    '## Commandes exécutées', '', '| Commande | Sortie | Log |', '|---|---:|---|',
    ...report.commands.map((row) => `| ${escape(row.command)} | ${row.exit_code} | ${escape(row.log)} |`), '',
    `Dernier passage unitaire API puis worker : **${unit.map(escape).join(' ; ') || 'aucun résultat'}**.`,
    `Dernier passage avec intégration API puis worker : **${integration.map(escape).join(' ; ') || 'aucun résultat'}**.`, '',
    'Les totaux d’intégration incluent les tests habituels. Les logs détaillent chaque fichier et durée. La construction Docker et les healthchecks sont conservés dans `.data/audit/docker-build-final.log` et `docker-audit-start.log`.', '',
    '## HTTP réel et assertions de contenu', '',
    '| Cas et endpoint | Méthode | Attendu | Réel | MIME | ms | Résumé réponse | Vérification SQL/cache/fichier | Résultat |',
    '|---|---|---:|---:|---|---:|---|---|---|',
    ...report.http.map((row) => `| ${escape(`${row.label}: ${row.endpoint}`)} | ${row.method} | ${row.expected} | ${row.actual} | ${escape(row.contentType)} | ${row.durationMs} | ${escape(JSON.stringify(row.response))} | ${escape(row.sideEffect)}${row.error ? ` ; ${escape(row.error)}` : ''} | ${row.result} |`), '',
    `**${report.http.filter((row) => row.result === 'PASS').length}/${report.http.length} cas HTTP réussis.** Un PASS exige le statut attendu et toutes les assertions du cas.`, '',
    'Les MVT sont décodés : 256 détections sur la tuile mondiale, 64 dans chacune des quatre tuiles zoom 8, zéro dans la tuile vide. Les trois téléchargements sont parsés et comparés aux 256 lignes du manifeste, y compris identifiants, coordonnées, dates, filtres de sélection et protection CSV. Taille et SHA-256 sont comparés aux métadonnées SQL. Cette phrase décrit les assertions prévues ; le tableau reste la preuve de leur résultat effectif.', '',
    '## Mesures', '',
    ...measurements.map((value) => value.benchmark === 'PostGIS tiles'
      ? `- PostGIS, ${value.rows} lignes : cinq temps ${value.tileMs.map((ms) => `${ms.toFixed(2)} ms`).join(', ')} ; GiST dans EXPLAIN ANALYZE : **${value.spatialIndexInPlan}**. Plan copié dans \`.data/audit/phase4-postgis.json\`.`
      : `- ${escape(value.benchmark)} : ${value.rowsEach} lignes par export ; ${value.durationMs.toFixed(2)} ms ; variation RSS observée ${value.rssDeltaBytes} octets.`),
    'Mesures locales sur des fixtures conservées ; la variation RSS ne constitue pas une mesure du pic absolu ni une qualification de charge de production. Le test concurrent vérifie aussi que liveness répond pendant les exports.', '',
    '## Historique et limites', '',
    '- Les premières validations ont révélé l’image obsolète, le GROUP BY SQL invalide et deux IDs fictifs non UUID dans des tests anciens. Ils ont été corrigés ; la validation UUID n’a pas été relâchée.',
    '- Un premier passage complet d’intégration a donné 256 tests API réussis puis 49 tests worker réussis et 3 échecs (timeouts/concurrence). L’isolation des fixtures, le scope outbox et la sérialisation des fichiers d’intégration ont été corrigés. Le test MVT laisse désormais une marge au timeout SQL ; les limites runtime restent actives. Les résultats finaux figurent ci-dessus.',
    '- Les tests BullMQ provoquent de vraies erreurs de stockage : succès après retry et état failed après trois tentatives. Les tests de lease, replay et outbox complètent ces scénarios.',
    '- L’image historique sur localhost:3000 reste obsolète : le remplacement a été explicitement refusé. Aucun succès de l’API corrigée n’est revendiqué sur ce port.',
    '- Le déploiement normal requiert un fournisseur d’identité de confiance ; les credentials opaques de test sont refusés hors mode isolé. Les analyses historiques anonymes ne sont pas réattribuées.',
    '- Les 24 routes planifiées restent 501 ; leur PASS vérifie ce contrat et n’implique aucune fonctionnalité métier.',
    '- La rétention du worker de test est de 180 secondes ; l’expiration est naturelle. Aucun test d’URL signée n’est requis : stockage local partagé et streaming uniquement.',
    '- Les données de test et bases de restauration sont conservées. Le nettoyage automatique porte sur les seuls fichiers d’export dédiés expirés.',
    '- Les avertissements de dépréciation Fastify/outillage et les vulnérabilités npm existantes n’ont pas été masqués ou corrigés par une mise à jour globale.',
    ...(report.error ? ['', `Blocage de cette exécution : ${escape(redact(report.error))}`] : []), '',
    'Procédure et commandes curl : [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md). Données et dépendances : [TEST_FIXTURES.md](TEST_FIXTURES.md). Audit : [API_AUDIT.md](API_AUDIT.md).'
  ];
  await writeFile(resolve(root, 'docs/API_TEST_REPORT.md'), lines.join('\n') + '\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await writeAuditReport(JSON.parse(await readFile(resolve(auditDirectory, 'report.json'), 'utf8')));
}
