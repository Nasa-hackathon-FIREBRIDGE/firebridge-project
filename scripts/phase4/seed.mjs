import { setTimeout as delay } from 'node:timers/promises';
import { actor, endDate, fixtureKey, fixturePlan, ids, startDate, sha256 } from './fixture.mjs';
import { configureFixtureEnvironment, inspectTestDatabase } from './environment.mjs';
import { prepareAssetArtifacts, writeImmutable } from './artifacts.mjs';
import { assertReleaseResolution, ingestFixture, prepareSourceAndArea, verifySelection } from './ingestion.mjs';

function options(args) {
  const value = { apply: false, queueExports: false, database: '', exportRun: 'v1' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') value.apply = true;
    else if (args[i] === '--queue-exports') value.queueExports = true;
    else if (args[i] === '--confirm-database') value.database = args[++i] ?? '';
    else if (args[i] === '--export-run') value.exportRun = args[++i] ?? '';
    else throw new Error('Arguments: [--apply --confirm-database <name>] [--queue-exports] [--export-run v1].');
  }
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(value.exportRun)) throw new Error('Invalid export run label.');
  if (value.queueExports && !value.apply) throw new Error('--queue-exports requires --apply and explicit database confirmation.');
  return value;
}

async function waitFor(fetch, predicate, label, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  console.info(`Waiting for ${label} (worker required, timeout ${seconds}s)...`);
  do {
    const value = await fetch();
    if (predicate(value)) return value;
    if (['failed', 'cancelled', 'unsupported'].includes(value.status)) throw new Error(`${label} reached a failed terminal state. Existing jobs were preserved.`);
    await delay(1000);
  } while (Date.now() < until);
  throw new Error(`Timeout waiting for ${label}. Start the isolated worker and rerun; queued jobs were preserved.`);
}

async function main() {
  const flags = options(process.argv.slice(2));
  const plan = fixturePlan();
  const { tile_expectations: tiles, ...summary } = plan;
  console.info(JSON.stringify({ ...summary, artifact_directory: '.data/phase4-rif-v1/<test_database_name>', tiles_by_zoom: Object.fromEntries([0, 4, 8, 12, 16, 18].map((z) => [z, tiles.filter((tile) => tile.z === z).length])),
    example_tiles_z8: tiles.filter((tile) => tile.z === 8) }, null, 2));
  if (!flags.apply) return; // No database imports, connections or file writes in preview.
  const target = await configureFixtureEnvironment();
  if (flags.database !== target.name) throw new Error('--confirm-database must exactly match the test database name.');
  const inspection = await inspectTestDatabase(target);
  const { prisma } = await import('@firebridge/database');
  const { Prisma, PrismaClient } = await import('@prisma/client');
  const locker = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    const { sourcesService } = await import('../../apps/api/dist/services/sources.service.js');
    const { areasService, computeGeometrySha256 } = await import('../../apps/api/dist/services/areas.service.js');
    const { areasRepository } = await import('../../apps/api/dist/repositories/areas.repository.js');
    const { sourceCreateSchema } = await import('../../apps/api/dist/validators/sources.validator.js');
    const { areaCreateSchema } = await import('../../apps/api/dist/validators/areas.validator.js');
    const { analysesService } = await import('../../apps/api/dist/services/analyses.service.js');
    const { analysisCreateSchema } = await import('../../apps/api/dist/validators/analyses.validator.js');
    const { detectionSelection, findResultContext } = await import('@firebridge/results');
    const services = { sources: sourcesService, areas: areasService, geometryHash: computeGeometrySha256,
      areaRepository: areasRepository, sourceSchema: sourceCreateSchema, areaSchema: areaCreateSchema };
    const manifest = await locker.$transaction(async (lock) => {
      await lock.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixtureKey}, 0))`;
      await assertReleaseResolution(prisma);
      const { sourceId, areaId, counts } = await prepareSourceAndArea(prisma, services);
      const artifacts = await prepareAssetArtifacts();
      const ingestionCounts = await ingestFixture(prisma, Prisma, sourceId, artifacts);
      console.info(JSON.stringify({ fixture_records: { ...counts, ...ingestionCounts }, excluded_from_results: 8,
        cleanup_scope: 'No database rows are deleted. Only expired worker-managed files in the dedicated test storage are cleaned.' }));
      // Recheck immediately before invoking the service's global release resolver.
      await assertReleaseResolution(prisma);
      const input = analysisCreateSchema.parse({ area_id: areaId, start_date: startDate, end_date_exclusive: endDate,
        time_basis: 'utc', selection_policy: 'standard', weighting_version: 'v1' });
      const { detail, created } = await analysesService.createAnalysis(input, actor, `${fixtureKey}:analysis`);
      console.info(JSON.stringify({ analysis: { id: detail.analysis.id, created: created ? 1 : 0, reused: created ? 0 : 1, skipped: 0 } }));
      const context = await findResultContext(detail.analysis.id, actor);
      if (!context?.authorized || context.release_id !== ids.release) throw new Error('Analysis owner or pinned release differs from the fixture. No existing analysis will be reassigned.');
      const jobs = await prisma.api_jobs.findMany({ where: { analysis_id: detail.analysis.id, kind: 'analysis', requested_by: actor }, select: { id: true }, take: 2 });
      if (jobs.length !== 1) throw new Error('Expected exactly one original fixture analysis job.');
      const events = await prisma.$queryRaw`
        SELECT payload->>'job_id' AS job_id FROM firebridge.outbox_events
        WHERE event_type = 'analysis.requested' AND aggregate_id = ${detail.analysis.id}
          AND dedupe_key = ${`analysis:${detail.analysis.id}:created`}`;
      if (events.length !== 1 || events[0].job_id !== jobs[0].id) throw new Error('Analysis job and original outbox event are not coherent.');
      const detectionIds = await prisma.detections.findMany({ where: { asset_id: { in: [ids.asset, ids['other-asset']] } },
        select: { id: true, native_record_key: true }, orderBy: { native_record_key: 'asc' } });
      const expected = { ...plan, execution: 'Prepared fixture; analysis and exports are processed by the real workers.' };
      return { ...expected, database: target.name, source_id: sourceId, area_id: areaId,
        analysis_id: detail.analysis.id, analysis_job_id: jobs[0].id,
        detection_ids: Object.fromEntries(detectionIds.map((row) => [row.native_record_key, String(row.id)])),
        artifacts, export_storage: 'dedicated fixture directory; see test launcher',
        ownership: 'Only phase4-fixture:rif:v1 may request these results.' };
    }, { timeout: 60000 });
    const manifestPath = await writeImmutable('manifest.json', manifest);
    console.info(`Fixture prepared. Manifest: ${manifestPath}`);
    console.info(`Analysis ${manifest.analysis_id}; source ${manifest.source_id}; actor ${actor}.`);
    // The audit is a separate snapshot, not part of deterministic fixture content.
    await writeImmutable(`database-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, inspection);
    if (!flags.queueExports) return;
    await waitFor(async () => (await analysesService.getAnalysisById(manifest.analysis_id)).analysis,
      (analysis) => ['ready', 'partial'].includes(analysis.status) && analysis.completed_at !== null, 'analysis');
    await verifySelection(prisma, manifest.analysis_id, detectionSelection);
    const { exportsService } = await import('../../apps/api/dist/services/exports.service.js');
    const { jobsService } = await import('../../apps/api/dist/services/jobs.service.js');
    const { exportInputSchema } = await import('@firebridge/results');
    const jobs = {};
    // Sequential completion respects EXPORT_MAX_ACTIVE_PER_USER=2 even when
    // all three formats are requested; files are generated only by the worker.
    for (const format of ['csv', 'geojson', 'parquet']) {
      const requestKey = `${fixtureKey}:${flags.exportRun}:${format}`;
      const existing = await prisma.api_jobs.findUnique({ where: { requested_by_idempotency_key: {
        requested_by: 'anonymous', idempotency_key: `export:${sha256(JSON.stringify([manifest.analysis_id, requestKey]))}`
      } }, select: { id: true } });
      const job = await exportsService.create(manifest.analysis_id,
        exportInputSchema.parse({ format }), requestKey);
      jobs[format] = { job_id: job.job_id, status_url: job.status_url, download_url: `/api/v1/jobs/${job.job_id}/download` };
      console.info(`${format}: ${job.job_id}`);
      console.info(JSON.stringify({ export: { format, id: job.job_id, created: existing ? 0 : 1, reused: existing ? 1 : 0, skipped: 0 } }));
      const events = await prisma.$queryRaw`
        SELECT payload->>'job_id' AS job_id FROM firebridge.outbox_events
        WHERE event_type = 'export.requested' AND aggregate_id = ${job.job_id}
          AND dedupe_key = ${`export:${job.job_id}:created`}`;
      if (events.length !== 1 || events[0].job_id !== job.job_id) throw new Error('Export job and original outbox event are not coherent.');
      await waitFor(() => jobsService.getJobById(job.job_id), (value) => value.status === 'succeeded', `${format} export`, 360);
      const file = await prisma.api_jobs.findUnique({ where: { id: job.job_id }, select: {
        result_sha256: true, result_byte_size: true, expires_at: true, result_manifest_uri: true
      } });
      if (!file?.result_manifest_uri || !/^[a-f0-9]{64}$/.test(file.result_sha256 ?? '')
        || file.result_byte_size === null || file.result_byte_size <= 0n || !file.expires_at || file.expires_at.getTime() <= Date.now()) {
        throw new Error('A completed export has missing or expired result metadata. Use a new export run label if necessary.');
      }
    }
    const filename = await writeImmutable(`exports-${flags.exportRun}.json`, { fixture: fixtureKey, analysis_id: manifest.analysis_id, jobs });
    console.info(`All export jobs succeeded. References: ${filename}`);
  } finally {
    await locker.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error?.constructor === Error && !error.code ? error.message : `Controlled fixture failure (${error?.name ?? 'unknown'}). Check the prerequisites; connection details are not printed.`;
  console.error(message);
  process.exitCode = 1;
});
