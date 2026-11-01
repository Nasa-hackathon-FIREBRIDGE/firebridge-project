import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { jobsService } from '../src/services/jobs.service.js';

type App = Awaited<ReturnType<typeof createApp>>;

const apps: App[] = [];

async function buildApp(): Promise<App> {
  const app = await createApp();
  await app.ready();
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

const VALID_JOB_ID = '44444444-4444-4444-8444-444444444444';
const VALID_ANALYSIS_ID = '33333333-3333-4333-8333-333333333333';

const MOCK_QUEUED_JOB = {
  id: VALID_JOB_ID,
  kind: 'analysis',
  status: 'queued',
  progress: { percent: 0, stage: 'queued' },
  current_stage: 'queued',
  attempt: 0,
  max_attempts: 3,
  retryable: false,
  error_code: null,
  expires_at: null,
  created_at: new Date('2026-10-30T00:00:00.000Z'),
  completed_at: null,
  analysis_id: VALID_ANALYSIS_ID
};

describe('GET /api/v1/jobs/:id — Endpoint 10', () => {
  it('returns HTTP 200 with job details for a queued job', async () => {
    vi.spyOn(jobsService, 'getJobById').mockResolvedValue(MOCK_QUEUED_JOB);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${VALID_JOB_ID}`
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.message).toBe('Job retrieved.');
    expect(json.data.id).toBe(VALID_JOB_ID);
    expect(json.data.status).toBe('queued');
    expect(json.data.retryable).toBe(false);
    expect(json.data.max_attempts).toBe(3);
  });

  it('reports retryable: true for a failed job with remaining attempts', async () => {
    const failedJob = {
      ...MOCK_QUEUED_JOB,
      status: 'failed',
      attempt: 1,
      retryable: true,
      error_code: 'SATELLITE_TIMEOUT'
    };
    vi.spyOn(jobsService, 'getJobById').mockResolvedValue(failedJob);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${VALID_JOB_ID}`
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data.status).toBe('failed');
    expect(json.data.attempt).toBe(1);
    expect(json.data.retryable).toBe(true);
    expect(json.data.error_code).toBe('SATELLITE_TIMEOUT');
  });

  it('reports retryable: false for a failed job that exceeded max attempts', async () => {
    const exhaustedJob = {
      ...MOCK_QUEUED_JOB,
      status: 'failed',
      attempt: 3,
      retryable: false,
      error_code: 'PERSISTENT_FAILURE'
    };
    vi.spyOn(jobsService, 'getJobById').mockResolvedValue(exhaustedJob);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${VALID_JOB_ID}`
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data.attempt).toBe(3);
    expect(json.data.retryable).toBe(false);
  });

  it('returns HTTP 404 when job does not exist', async () => {
    const { NotFoundError } = await import('../src/errors/app-error.js');
    vi.spyOn(jobsService, 'getJobById').mockRejectedValue(
      new NotFoundError(`Job with id '00000000-0000-0000-0000-000000000000' was not found.`)
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/00000000-0000-0000-0000-000000000000'
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      status: 'error',
      code: 'NOT_FOUND',
      message: "Job with id '00000000-0000-0000-0000-000000000000' was not found.",
      data: null
    });
  });

  it('does not expose internal server secrets or stack traces', async () => {
    vi.spyOn(jobsService, 'getJobById').mockRejectedValue(
      new Error('SELECT failed: relation "api_jobs" connection pool exhausted')
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${VALID_JOB_ID}`
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
      data: null
    });
    const text = JSON.stringify(response.json());
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('connection pool');
    expect(text).not.toContain('api_jobs');
  });
});
