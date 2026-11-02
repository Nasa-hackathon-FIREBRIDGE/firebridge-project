import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('bullmq', () => {
  class Connection {
    on() {
      return this;
    }
    async close() {}
  }
  return { Worker: Connection, Queue: Connection };
});
import { shutdownManager } from '../src/shutdown/shutdown-manager.js';
import { workerStatus } from '../src/worker.js';

describe('FIREBRIDGE worker', () => {
  afterAll(async () => {
    await shutdownManager.shutdown();
  });

  it('reports starting status without autostart and registered processors with a valid timestamp', () => {
    expect(workerStatus.status).toBe('starting');
    expect(workerStatus.service).toBe('firebridge-worker');
    expect(workerStatus.processorsRegistered).toContain('analysis.requested');

    const startedAt = new Date(workerStatus.startedAt);
    expect(Number.isNaN(startedAt.getTime())).toBe(false);
    expect(startedAt.toISOString()).toBe(workerStatus.startedAt);
  });
});
