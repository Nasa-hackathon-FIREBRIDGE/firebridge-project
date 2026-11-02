import './config/env.js';
import { UnrecoverableError, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { prisma } from '@firebridge/database';
import { resultsConfig } from '@firebridge/results';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { processAnalysisJob, type AnalysisJobPayload } from './processors/analysis.processor.js';
import { processExportJob, type ExportJobPayload } from './processors/export.processor.js';
import { ExportCleanup } from './services/export-cleanup.js';
import { WorkerHeartbeat } from './services/worker-heartbeat.js';
import { AnalysisRecovery } from './services/analysis-recovery.js';
import { collectWorkerMetrics } from './services/worker-metrics.js';
import {
  createFirebridgeQueue,
  FIREBRIDGE_QUEUE,
  EXPORT_QUEUE,
  parseRedisConnection
} from './queues/firebridge-queue.js';
import { OutboxDispatcher } from './services/outbox-dispatcher.js';
import { shutdownManager } from './shutdown/shutdown-manager.js';
import { processExplanation, type ExplanationPayload } from './processors/explanation.processor.js';
import {
  processIngestionPlan,
  type IngestionPlanPayload
} from './processors/ingestion-plan.processor.js';

export interface WorkerStatus {
  status: 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped' | 'not_configured';
  service: string;
  startedAt: string;
  processorsRegistered: string[];
  jobsProcessed: number;
  jobsFailed: number;
}

export const workerStatus: WorkerStatus = {
  status: 'starting',
  service: 'firebridge-worker',
  startedAt: new Date().toISOString(),
  processorsRegistered: [
    'analysis.requested',
    'export.requested',
    'ingestion.plan.requested',
    'explanation.requested'
  ],
  jobsProcessed: 0,
  jobsFailed: 0
};

// 1. Initialize BullMQ Queue
export const firebridgeQueue = createFirebridgeQueue(FIREBRIDGE_QUEUE, env.REDIS_URL);
export const exportQueue = createFirebridgeQueue(EXPORT_QUEUE, env.REDIS_URL);
export const exportCleanup = new ExportCleanup();
export const heartbeat = new WorkerHeartbeat();
export const analysisRecovery =
  env.RECOVERY_ENABLED === 'true'
    ? new AnalysisRecovery(firebridgeQueue, new Date(env.RECOVERY_CREATED_AFTER!))
    : undefined;

// 2. Initialize Outbox Dispatcher
export const outboxDispatcher = new OutboxDispatcher({
  queue: firebridgeQueue,
  exportQueue,
  batchSize: env.OUTBOX_BATCH_SIZE,
  pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
  leaseSeconds: env.OUTBOX_LEASE_SECONDS
});

// 3. Initialize BullMQ Worker with real processors
export const bullWorker = new Worker<
  AnalysisJobPayload | IngestionPlanPayload | ExplanationPayload
>(
  FIREBRIDGE_QUEUE,
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Worker received job');
    if (job.name === 'analysis.requested') {
      await processAnalysisJob(job as Job<AnalysisJobPayload>);
    } else if (job.name === 'ingestion.plan.requested') {
      await processIngestionPlan(job.data);
    } else if (job.name === 'explanation.requested') {
      await processExplanation(job.data);
    } else {
      throw new UnrecoverableError('Unsupported task name.');
    }
  },
  {
    connection: parseRedisConnection(env.REDIS_URL),
    concurrency: env.ANALYSIS_WORKER_CONCURRENCY,
    autorun: false,
    lockDuration: 30000,
    stalledInterval: 30000,
    maxStalledCount: 2
  }
);

export const exportWorker = new Worker<ExportJobPayload>(
  EXPORT_QUEUE,
  async (job) => {
    if (job.name !== 'export.requested') throw new UnrecoverableError('Unsupported export task.');
    await processExportJob(job);
  },
  {
    connection: parseRedisConnection(env.REDIS_URL),
    concurrency: resultsConfig.EXPORT_WORKER_CONCURRENCY,
    autorun: false
  }
);
exportWorker.on('completed', () => {
  workerStatus.jobsProcessed++;
});
exportWorker.on('failed', (job) => {
  workerStatus.jobsFailed++;
  logger.error({ jobId: job?.id }, 'Export task failed');
});
exportWorker.on('error', () => {
  workerStatus.status = 'degraded';
  logger.error('Export queue worker error');
});

bullWorker.on('completed', (job) => {
  workerStatus.jobsProcessed++;
  logger.info({ jobId: job.id, name: job.name }, 'Job completed successfully');
});

bullWorker.on('failed', (job) => {
  workerStatus.jobsFailed++;
  logger.error({ jobId: job?.id, attempt: job?.attemptsMade }, 'Job failed during execution');
});

bullWorker.on('error', () => {
  logger.error('BullMQ worker encountered an error');
  if (workerStatus.status === 'running') {
    workerStatus.status = 'degraded';
  }
});

// Start consumers only after both dependencies are ready.
let startup: Promise<void> | undefined;
export function startWorker(): Promise<void> {
  startup ??= initializeWorker();
  return startup;
}

async function initializeWorker(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
  await Promise.all([
    bullWorker.waitUntilReady(),
    exportWorker.waitUntilReady(),
    firebridgeQueue.waitUntilReady(),
    exportQueue.waitUntilReady()
  ]);
  if (workerStatus.status === 'stopping' || workerStatus.status === 'stopped') return;
  void bullWorker.run().catch(() => {
    workerStatus.status = 'degraded';
    logger.error('Analysis worker loop stopped');
  });
  void exportWorker.run().catch(() => {
    workerStatus.status = 'degraded';
    logger.error('Export worker loop stopped');
  });
  outboxDispatcher.start();
  analysisRecovery?.start();
  exportCleanup.start();
  heartbeat.start(async () => {
    const metrics = await collectWorkerMetrics(firebridgeQueue, exportQueue);
    if (!['stopping', 'stopped'].includes(workerStatus.status)) {
      workerStatus.status =
        metrics.databaseAvailable &&
        metrics.redisAvailable &&
        bullWorker.isRunning() &&
        exportWorker.isRunning()
          ? 'running'
          : 'degraded';
    }
    return {
      ...workerStatus,
      metrics,
      outbox: outboxDispatcher.metrics,
      recovery: analysisRecovery?.metrics
    };
  });
  workerStatus.status = 'running';
  logger.info(
    {
      service: workerStatus.service,
      processors: workerStatus.processorsRegistered,
      queue: FIREBRIDGE_QUEUE
    },
    'FIREBRIDGE worker started and actively consuming jobs'
  );
}

export async function stopWorker(): Promise<void> {
  await shutdownManager.shutdown();
  workerStatus.status = 'stopped';
}

// 5. Register shutdown hooks
shutdownManager.register({
  worker: bullWorker,
  queue: firebridgeQueue,
  dispatcher: outboxDispatcher,
  exportWorker,
  exportQueue,
  exportCleanup,
  heartbeat,
  recovery: analysisRecovery,
  onShutdown: () => {
    workerStatus.status = 'stopping';
  }
});
shutdownManager.setupSignalHandlers();

for (const queue of [firebridgeQueue, exportQueue])
  queue.on('error', () => logger.error('Queue connection error'));
for (const worker of [bullWorker, exportWorker]) {
  worker.on('stalled', (jobId) => logger.warn({ jobId }, 'Queue job stalled'));
}

if (
  env.WORKER_AUTOSTART === 'true' ||
  (env.NODE_ENV !== 'test' && env.WORKER_AUTOSTART !== 'false')
) {
  void startWorker().catch(async () => {
    workerStatus.status = 'degraded';
    logger.error('Worker startup failed');
    process.exitCode = 1;
    await stopWorker().catch(() => logger.error('Startup cleanup failed'));
  });
}
