import { describe, expect, it } from 'vitest';
import { workerStatus } from '../src/worker.js';

describe('FIREBRIDGE worker', () => {
  it('exposes its startup status with a valid start time', () => {
    expect(workerStatus.status).toBe('running');
    expect(workerStatus.service).toBe('firebridge-worker');

    const startedAt = new Date(workerStatus.startedAt);
    expect(Number.isNaN(startedAt.getTime())).toBe(false);
    expect(startedAt.toISOString()).toBe(workerStatus.startedAt);
  });
});
