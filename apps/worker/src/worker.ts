import './config/env.js';
import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { processAnalysisJob, type AnalysisJobPayload } from './processors/analysis.processor.js';
import {
  createFirebridgeQueue,
  FIREBRIDGE_QUEUE,
  parseRedisConnection
} from './queues/firebridge-queue.js';
import { OutboxDispatcher } from './services/outbox-dispatcher.js';
import { shutdownManager } from './shutdown/shutdown-manager.js';

export interface WorkerStatus {
  status: 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped' | 'not_configured';
  service: string;
  startedAt: string;
  processorsRegistered: string[];
  jobsProcessed: number;
  jobsFailed: number;
}

export const workerStatus: WorkerStatus = {
  status: 'running',
  service: 'firebridge-worker',
  startedAt: new Date().toISOString(),
  processorsRegistered: ['analysis.requested'],
  jobsProcessed: 0,
  jobsFailed: 0
};

// 1. Initialize BullMQ Queue
export const firebridgeQueue = createFirebridgeQueue(FIREBRIDGE_QUEUE, env.REDIS_URL);

// 2. Initialize Outbox Dispatcher
export const outboxDispatcher = new OutboxDispatcher({
  queue: firebridgeQueue,
  batchSize: env.OUTBOX_BATCH_SIZE,
  pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
  leaseSeconds: env.OUTBOX_LEASE_SECONDS
});

// 3. Initialize BullMQ Worker with real processors
export const bullWorker = new Worker<AnalysisJobPayload>(
  FIREBRIDGE_QUEUE,
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Worker received job');
    if (job.name === 'analysis.requested') {
      await processAnalysisJob(job);
    } else {
      logger.warn({ name: job.name, jobId: job.id }, 'Received job with unhandled name');
    }
  },
  {
    connection: parseRedisConnection(env.REDIS_URL),
    concurrency: 5
  }
);

bullWorker.on('completed', (job) => {
  workerStatus.jobsProcessed++;
  logger.info({ jobId: job.id, name: job.name }, 'Job completed successfully');
});

bullWorker.on('failed', (job, err) => {
  workerStatus.jobsFailed++;
  logger.error({ jobId: job?.id, name: job?.name, err }, 'Job failed during execution');
});

bullWorker.on('error', (err) => {
  logger.error({ err }, 'BullMQ worker encountered an error');
  if (workerStatus.status === 'running') {
    workerStatus.status = 'degraded';
  }
});

// 4. Start Outbox Dispatcher in non-test mode
export function startWorker(): void {
  outboxDispatcher.start();
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

if (env.NODE_ENV !== 'test') {
  startWorker();
}

// 5. Register shutdown hooks
shutdownManager.register({
  worker: bullWorker,
  queue: firebridgeQueue,
  dispatcher: outboxDispatcher,
  onShutdown: () => {
    workerStatus.status = 'stopping';
  }
});
shutdownManager.setupSignalHandlers();
