import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { healthService } from '../src/services/health.service.js';

describe('FIREBRIDGE API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the health endpoint', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v1/health/live');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('firebridge-api');
  });

  it('forwards rejected async readiness checks to the safe error handler', async () => {
    vi.spyOn(healthService, 'getReadiness').mockRejectedValue(new Error('private connection details'));

    const response = await request(createApp()).get('/api/v1/health/ready');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Internal server error.');
    expect(JSON.stringify(response.body)).not.toContain('private connection details');
  });

  it('returns 503 when required readiness dependencies are unavailable', async () => {
    vi.spyOn(healthService, 'getReadiness').mockResolvedValue({
      status: 'error',
      service: 'firebridge-api',
      checks: {
        database: 'unavailable',
        redis: 'unavailable',
        workers: 'not_checked'
      },
      timestamp: new Date().toISOString()
    });

    const response = await request(createApp()).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.checks.workers).toBe('not_checked');
  });
});
