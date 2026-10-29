import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  pingRedis: vi.fn()
}));

vi.mock('@firebridge/database', () => ({
  prisma: { $queryRaw: mocks.queryRaw }
}));

vi.mock('../src/config/redis.js', () => ({
  pingRedis: mocks.pingRedis
}));

import { healthService, registerPhase1ReadinessProvider } from '../src/services/health.service.js';

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

describe('healthService.getLiveStatus', () => {
  it('returns status ok with service identifier and a timestamp without calling any dependency', () => {
    // Establish that no mocked dependency is called.
    const result = healthService.getLiveStatus();

    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.pingRedis).not.toHaveBeenCalled();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('firebridge-api');
    expect(typeof result.uptimeMs).toBe('number');
    expect(result.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.timestamp).toBe('string');
    // Must be a valid ISO-8601 date string.
    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('does not expose internal error details', () => {
    const result = healthService.getLiveStatus();
    const serialised = JSON.stringify(result);
    // Confirm there are no internal keys that could leak runtime state.
    expect(serialised).not.toContain('stack');
    expect(serialised).not.toContain('NODE_ENV');
    expect(serialised).not.toContain('DATABASE_URL');
  });
});

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

describe('healthService.getReadiness', () => {
  beforeEach(() => {
    mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mocks.pingRedis.mockResolvedValue('PONG');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns status ok and marks all required checks as ready when every probe succeeds', async () => {
    const result = await healthService.getReadiness();

    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.pingRedis).toHaveBeenCalledOnce();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('firebridge-api');
    expect(result.checks).toEqual({
      database: 'ready',
      redis: 'ready',
      workers: 'not_checked'
    });
    expect(typeof result.timestamp).toBe('string');
  });

  it('returns status error and marks failing required dependencies as unavailable', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('connection refused — internal detail'));
    mocks.pingRedis.mockResolvedValue('NOT_PONG');

    const result = await healthService.getReadiness();

    expect(result.status).toBe('error');
    expect(result.checks).toEqual({
      database: 'unavailable',
      redis: 'unavailable',
      workers: 'not_checked'
    });
  });

  it('returns status error when PostgreSQL is unavailable', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));
    // Redis is healthy; only DB fails.
    mocks.pingRedis.mockResolvedValue('PONG');

    const result = await healthService.getReadiness();

    expect(result.status).toBe('error');
    expect(result.checks.database).toBe('unavailable');
    expect(result.checks.redis).toBe('ready');
  });

  it('returns status error when Redis is unavailable', async () => {
    mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mocks.pingRedis.mockRejectedValue(new Error('Redis client is not available'));

    const result = await healthService.getReadiness();

    expect(result.status).toBe('error');
    expect(result.checks.database).toBe('ready');
    expect(result.checks.redis).toBe('unavailable');
  });

  it('bounds readiness checks that never resolve and returns status error', async () => {
    vi.useFakeTimers();
    mocks.queryRaw.mockImplementation(() => new Promise(() => {}));
    mocks.pingRedis.mockImplementation(() => new Promise(() => {}));

    const pendingResult = healthService.getReadiness();
    // Advance past the 3-second timeout.
    await vi.advanceTimersByTimeAsync(3000);
    const result = await pendingResult;

    expect(result.status).toBe('error');
    expect(result.checks.database).toBe('unavailable');
    expect(result.checks.redis).toBe('unavailable');
  });

  it('does not expose internal error messages in the response', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('private host=prod-db.internal port=5432'));
    mocks.pingRedis.mockRejectedValue(new Error('redis://user:secret@internal-redis:6379'));

    const result = await healthService.getReadiness();

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('prod-db.internal');
    expect(serialised).not.toContain('secret');
    expect(serialised).not.toContain('stack');
  });

  describe('Phase 1 catalogue readiness integration contract', () => {
    it('returns status ok when Phase 1 provider confirms catalogue is servable', async () => {
      registerPhase1ReadinessProvider({
        isCatalogueServable: vi.fn().mockResolvedValue(true)
      });

      const result = await healthService.getReadiness();

      expect(result.status).toBe('ok');
      expect(result.checks.database).toBe('ready');
      expect(result.checks.redis).toBe('ready');

      registerPhase1ReadinessProvider(null);
    });

    it('returns status error when Phase 1 provider reports catalogue is unservable', async () => {
      registerPhase1ReadinessProvider({
        isCatalogueServable: vi.fn().mockResolvedValue(false)
      });

      const result = await healthService.getReadiness();

      expect(result.status).toBe('error');

      registerPhase1ReadinessProvider(null);
    });
  });
});
