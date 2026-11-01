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
  exportWorker?: Worker;
  exportQueue?: Queue;
  exportCleanup?: { stop(): Promise<void> };
  heartbeat?: { stop(): Promise<void> };
  recovery?: { stop(): Promise<void> };
  onShutdown?: () => void;
}

export class ShutdownManager {
  private resources: ShutdownResources = {};
  private pending?: Promise<void>;
  private handlersRegistered = false;

  register(resources: ShutdownResources): void {
    this.resources = { ...this.resources, ...resources };
  }

  setupSignalHandlers(): void {
    if (this.handlersRegistered) return;
    this.handlersRegistered = true;
    const handleSignal = async (signal: string) => {
      logger.info({ signal }, `Received ${signal}; starting graceful shutdown...`);
      const deadline = setTimeout(() => process.exit(1), 30000);
      deadline.unref();
      try { await this.shutdown(); process.exitCode = 0; }
      catch { process.exitCode = 1; }
      finally { clearTimeout(deadline); }
    };

    process.once('SIGINT', () => void handleSignal('SIGINT'));
    process.once('SIGTERM', () => void handleSignal('SIGTERM'));
  }

  shutdown(): Promise<void> {
    this.pending ??= this.closeResources();
    return this.pending;
  }

  private async closeResources(): Promise<void> {
    const errors: unknown[] = [];
    const steps = [
      () => this.resources.onShutdown?.(),
      () => this.resources.dispatcher?.stop(),
      () => this.resources.recovery?.stop(),
      () => this.resources.exportCleanup?.stop(),
      () => this.resources.exportWorker?.close(),
      () => this.resources.worker?.close(),
      () => this.resources.exportQueue?.close(),
      () => this.resources.queue?.close(),
      () => this.resources.heartbeat?.stop(),
      () => disconnectDatabase()
    ];
    for (const close of steps) {
      try { await close(); }
      catch { errors.push(new Error('Resource shutdown failed.')); }
    }
    if (errors.length) {
      logger.error({ failures: errors.length }, 'Worker shutdown incomplete');
      throw new AggregateError(errors, 'Worker shutdown incomplete.');
    }
    logger.info('Graceful shutdown completed');
  }
}

export const shutdownManager = new ShutdownManager();

