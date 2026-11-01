/**
 * Graceful shutdown manager for FIREBRIDGE worker
 */

import { disconnectDatabase } from '@firebridge/database';
import type { Queue, Worker } from 'bullmq';
import { logger } from '../config/logger.js';
import type { OutboxDispatcher } from '../services/outbox-dispatcher.js';

export interface ShutdownResources {
  worker?: Worker;
  queue?: Queue;
  dispatcher?: OutboxDispatcher;
  onShutdown?: () => void;
}

export class ShutdownManager {
  private resources: ShutdownResources = {};
  private isShuttingDown: boolean = false;

  register(resources: ShutdownResources): void {
    this.resources = { ...this.resources, ...resources };
  }

  setupSignalHandlers(): void {
    const handleSignal = async (signal: string) => {
      logger.info({ signal }, `Received ${signal}; starting graceful shutdown...`);
      await this.shutdown();
      process.exit(0);
    };

    process.once('SIGINT', () => void handleSignal('SIGINT'));
    process.once('SIGTERM', () => void handleSignal('SIGTERM'));
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    try {
      if (this.resources.onShutdown) {
        this.resources.onShutdown();
      }

      // 1. Stop outbox dispatcher
      if (this.resources.dispatcher) {
        logger.info('Stopping outbox dispatcher...');
        await this.resources.dispatcher.stop();
      }

      // 2. Pause and close BullMQ worker
      if (this.resources.worker) {
        logger.info('Closing BullMQ worker...');
        await this.resources.worker.close();
      }

      // 3. Close BullMQ queue
      if (this.resources.queue) {
        logger.info('Closing BullMQ queue...');
        await this.resources.queue.close();
      }

      // 4. Disconnect PostgreSQL
      logger.info('Disconnecting database...');
      await disconnectDatabase();

      logger.info('Graceful shutdown completed successfully');
    } catch (error) {
      logger.error({ err: error }, 'Error during graceful shutdown');
    }
  }
}

export const shutdownManager = new ShutdownManager();
