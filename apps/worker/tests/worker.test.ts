import { describe, expect, it } from 'vitest';
import { workerStatus } from '../src/worker.js';

describe('FIREBRIDGE worker', () => {
  it('reports that no processors are registered with a valid status timestamp', () => {
    expect(workerStatus.status).toBe('not_configured');
    expect(workerStatus.service).toBe('firebridge-worker');

    const startedAt = new Date(workerStatus.startedAt);
    expect(Number.isNaN(startedAt.getTime())).toBe(false);
    expect(startedAt.toISOString()).toBe(workerStatus.startedAt);
  });
});
