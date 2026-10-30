import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { healthService } from '../src/services/health.service.js';

type App = Awaited<ReturnType<typeof createApp>>;

const apps: App[] = [];

async function buildApp(): Promise<App> {
  // inject() cannot capture bodies written through @fastify/express, so the Fastify-native routes
  // are exercised without the legacy Express layer; the layer itself is covered over real HTTP below.
  const app = await createApp({ legacyExpress: false });
  await app.ready();
  apps.push(app);
  return app;
}

/** Full app (legacy Express layer enabled) listening on an ephemeral port. */
async function listenFullApp(): Promise<{ app: App; baseUrl: string }> {
  const app = await createApp();
  apps.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('FIREBRIDGE API', () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.restoreAllMocks();
  });

  it('exposes the health endpoint', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
    expect(response.json().service).toBe('firebridge-api');
  });

  it('forwards rejected async readiness checks to the safe error handler', async () => {
    vi.spyOn(healthService, 'getReadiness').mockRejectedValue(new Error('private connection details'));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe('Internal server error.');
    expect(JSON.stringify(response.json())).not.toContain('private connection details');
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

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.workers).toBe('not_checked');
  });

  // Full-stack checks with the legacy Express layer enabled (real HTTP, since inject() cannot read its bodies).
  it('serves native routes with security headers when the legacy Express layer is enabled', async () => {
    const { baseUrl } = await listenFullApp();

    const response = await fetch(`${baseUrl}/api/v1/health/live`);

    expect(response.status).toBe(200);
    expect((await response.json()).service).toBe('firebridge-api');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('answers unknown paths with the 404 envelope and security headers when the legacy Express layer is enabled', async () => {
    const { baseUrl } = await listenFullApp();

    for (const path of ['/nope', '/api/v1/nope', '/api/v1/health/nope']) {
      const response = await fetch(`${baseUrl}${path}`);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Resource not found.',
        data: null
      });
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });
});