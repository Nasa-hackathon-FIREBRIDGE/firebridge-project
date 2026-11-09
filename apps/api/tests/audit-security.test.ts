import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { jobsRepository } from '../src/repositories/jobs.repository.js';

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
async function build() {
  const app = await createApp();
  apps.push(app);
  return app;
}
const id = '44444444-4444-4444-8444-444444444444';
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe('Existing API without temporary authentication', () => {
  it.each(['/api/v1/sources', '/api/v1/areas', '/api/v1/analyses'])(
    'validates writes to %s without demanding an identity',
    async (url) => {
      expect((await (await build()).inject({ method: 'POST', url, payload: {} })).statusCode).toBe(
        400
      );
    }
  );
  it('lists jobs without a token and without leaking internal metadata', async () => {
    vi.spyOn(jobsRepository, 'list').mockResolvedValue([]);
    const response = await (await build()).inject({ url: '/api/v1/jobs' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.jobs).toEqual([]);
    expect(jobsRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
      undefined
    );
  });
  it.each([
    '/api/v1/jobs/not-a-uuid',
    '/api/v1/analyses/not-a-uuid',
    '/api/v1/jobs?limit=0',
    '/api/v1/jobs?arbitrary=true'
  ])('retains validation of %s', async (url) => {
    expect((await (await build()).inject({ url })).statusCode).toBe(400);
  });
  it('does not reflect an unconfigured CORS origin or enable credentials', async () => {
    const app = await build();
    const direct = await app.inject({ url: '/api/v1/health/live' });
    const cross = await app.inject({
      url: '/api/v1/health/live',
      headers: { origin: 'http://evil.example' }
    });
    expect(direct.statusCode).toBe(200);
    expect(cross.headers['access-control-allow-origin']).toBeUndefined();
    expect(cross.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('All registered routes and generated documentation', () => {
  it('documents actual routes, including nested MVT and downloads, without duplicate /api/v1 servers', async () => {
    const app = await build();
    await app.ready();
    const spec = app.swagger();
    expect(spec.paths).toHaveProperty('/api/v1/analyses/{id}/tiles/{layer}/{z}/{x}/{y}.mvt');
    expect(spec.paths).toHaveProperty('/api/v1/jobs/{id}/download');
    expect(
      Object.keys(spec.paths ?? {}).filter((path) => path.startsWith('/api/v1/')).length
    ).toBeGreaterThan(25);
  });
  it('exposes canonical resources and removes all 18 retired scaffold operations', async () => {
    const app = await build();
    await app.ready();
    const paths = app.swagger().paths ?? {};
    const retired = [
      ['GET', '/detections'], ['POST', '/detections'],
      ['GET', '/tiles'], ['GET', '/tiles/' + id],
      ['GET', '/cells'], ['GET', '/cells/' + id],
      ['GET', '/weather'], ['GET', '/weather/' + id],
      ['GET', '/reports'], ['POST', '/reports'],
      ['GET', '/provenance'], ['GET', '/provenance/' + id],
      ['GET', '/explanations'], ['POST', '/explanations'],
      ['GET', '/exports'], ['POST', '/exports'],
      ['GET', '/admin/status'], ['POST', '/admin/refresh']
    ] as const;
    for (const [method, path] of retired) {
      const response = await app.inject({
        method, url: '/api/v1' + path,
        ...(method === 'POST' ? { payload: {} } : {})
      });
      expect(response.statusCode, method + ' ' + path).toBe(404);
    }
    for (const suffix of ['detections', 'provenance', 'weather', 'reports', 'coverage',
      'cells/{cell_id}', 'comparison', 'explanations', 'exports']) {
      expect(paths, suffix).toHaveProperty('/api/v1/analyses/{id}/' + suffix);
    }
    expect(paths).toHaveProperty('/api/v1/explanations/{id}');
    expect(paths).toHaveProperty('/api/v1/admin/ingestion/subscriptions');
    expect(paths).toHaveProperty('/api/v1/admin/ingestion/backfills');
  });
});
