import { afterEach, describe, expect, it, vi } from 'vitest';
import request, { testServer } from './helpers/http.js';
const mocks = vi.hoisted(() => ({ getLiveStatus: vi.fn(), getReadiness: vi.fn() }));
vi.mock('../src/services/health.service.js', () => ({ healthService: mocks }));
import { healthController } from '../src/controllers/health.controller.js';

function app() {
  const server = testServer();
  server.decorate('phase1ReadinessProvider', { isCatalogueServable: async () => true });
  server.decorate('readinessChecks', {});
  server.get('/live', healthController.getLiveStatus);
  server.get('/ready', healthController.getReadiness);
  return server;
}
afterEach(() => vi.resetAllMocks());
describe('Fastify health controllers', () => {
  it('returns the liveness payload without readiness I/O', async () => {
    const payload = {
      status: 'ok',
      service: 'firebridge-api',
      uptimeMs: 10,
      timestamp: new Date().toISOString()
    };
    mocks.getLiveStatus.mockReturnValue(payload);
    const response = await request(app()).get('/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(payload);
    expect(mocks.getReadiness).not.toHaveBeenCalled();
  });
  for (const status of ['ok', 'error'] as const) {
    it('maps readiness ' + status + ' to the HTTP status', async () => {
      const payload = {
        status,
        service: 'firebridge-api',
        checks: { database: 'ready', redis: 'ready', workers: 'not_checked' },
        timestamp: new Date().toISOString()
      };
      mocks.getReadiness.mockResolvedValue(payload);
      const response = await request(app()).get('/ready');
      expect(response.status).toBe(status === 'ok' ? 200 : 503);
      expect(response.body).toEqual(payload);
      expect(mocks.getReadiness).toHaveBeenCalledWith(
        expect.objectContaining({ isCatalogueServable: expect.any(Function) }),
        {}
      );
      expect(mocks.getLiveStatus).not.toHaveBeenCalled();
    });
  }
  it('passes rejected readiness checks to the safe Fastify error handler', async () => {
    mocks.getReadiness.mockRejectedValue(new Error('private connection string'));
    const response = await request(app()).get('/ready');
    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('private connection string');
  });
});
