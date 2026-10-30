import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { analysesService } from '../src/services/analyses.service.js';

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

const VALID_AREA_ID = '11111111-1111-4111-8111-111111111111';
const VALID_RELEASE_ID = '22222222-2222-4222-8222-222222222222';
const VALID_ANALYSIS_ID = '33333333-3333-4333-8333-333333333333';
const VALID_JOB_ID = '44444444-4444-4444-8444-444444444444';

const VALID_ANALYSIS_INPUT = {
  area_id: VALID_AREA_ID,
  start_date: '2026-08-01',
  end_date_exclusive: '2026-08-10',
  time_basis: 'utc' as const,
  selection_policy: 'standard',
  weighting_version: 'v1'
};

const MOCK_ANALYSIS_DETAIL = {
  analysis: {
    id: VALID_ANALYSIS_ID,
    area_id: VALID_AREA_ID,
    release_id: VALID_RELEASE_ID,
    start_date: '2026-08-01',
    end_date_exclusive: '2026-08-10',
    time_basis: 'utc',
    metric_key: 'native_detections_v1',
    grid_id: null,
    selection_policy: 'standard',
    weighting_version: 'v1',
    baseline_spec: null,
    weather_policy: {},
    news_policy: {},
    request_spec: {},
    cache_key: 'mock-cache-key-123',
    status: 'queued',
    error_code: null,
    created_at: new Date('2026-10-30T00:00:00.000Z'),
    completed_at: null
  },
  components: [
    {
      analysis_id: VALID_ANALYSIS_ID,
      component: 'satellite',
      release_id: VALID_RELEASE_ID,
      status: 'ready',
      reasons: []
    },
    {
      analysis_id: VALID_ANALYSIS_ID,
      component: 'weather_historical',
      release_id: null,
      status: 'missing',
      reasons: ['No published weather release']
    }
  ],
  job: {
    id: VALID_JOB_ID,
    kind: 'analysis',
    analysis_id: VALID_ANALYSIS_ID,
    explanation_id: null,
    requested_by: 'anonymous',
    request_hash: 'mock-cache-key-123',
    idempotency_key: 'auto:mock-cache-key-123',
    request_spec: {},
    status: 'queued',
    attempt: 0,
    progress: { percent: 0, stage: 'queued' },
    error_code: null,
    expires_at: null,
    created_at: new Date('2026-10-30T00:00:00.000Z'),
    completed_at: null
  }
};

describe('POST /api/v1/analyses — Endpoint 8', () => {
  it('returns HTTP 202 with analysis and job identifiers when creating a new analysis', async () => {
    const create = vi.spyOn(analysesService, 'createAnalysis').mockResolvedValue({
      detail: MOCK_ANALYSIS_DETAIL,
      created: true
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: VALID_ANALYSIS_INPUT
    });

    expect(response.statusCode).toBe(202);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.message).toBe('Analysis queued.');
    expect(json.data.id).toBe(VALID_ANALYSIS_ID);
    expect(json.data.job_id).toBe(VALID_JOB_ID);
    expect(json.data.metric_key).toBe('native_detections_v1');
    expect(json.data.grid_id).toBeNull();
    expect(json.data.data_mode).toBe('standard_only');
    expect(create).toHaveBeenCalledOnce();
  });

  it('returns HTTP 200 when an equivalent analysis already exists (idempotent reuse)', async () => {
    vi.spyOn(analysesService, 'createAnalysis').mockResolvedValue({
      detail: MOCK_ANALYSIS_DETAIL,
      created: false
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: VALID_ANALYSIS_INPUT
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.message).toBe('Existing analysis reused.');
    expect(json.data.id).toBe(VALID_ANALYSIS_ID);
    expect(json.data.job_id).toBe(VALID_JOB_ID);
  });

  it('returns HTTP 400 when area_id is missing or not a valid UUID', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: { ...VALID_ANALYSIS_INPUT, area_id: 'not-a-uuid' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when end_date_exclusive is not after start_date', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: {
        ...VALID_ANALYSIS_INPUT,
        start_date: '2026-08-10',
        end_date_exclusive: '2026-08-01'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when dates are not formatted as YYYY-MM-DD', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: {
        ...VALID_ANALYSIS_INPUT,
        start_date: '01-08-2026'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when an unknown field is supplied', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: {
        ...VALID_ANALYSIS_INPUT,
        unknown_property: 'not_allowed'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when no compatible published release exists', async () => {
    const { BadRequestError } = await import('../src/errors/app-error.js');
    vi.spyOn(analysesService, 'createAnalysis').mockRejectedValue(
      new BadRequestError(
        'No published satellite release covers the requested time window.',
        'NO_COMPATIBLE_RELEASE'
      )
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: VALID_ANALYSIS_INPUT
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'NO_COMPATIBLE_RELEASE',
      message: 'No published satellite release covers the requested time window.',
      data: null
    });
  });

  it('returns HTTP 503 and a sanitized error when database is unreachable', async () => {
    const { ServiceUnavailableError } = await import('../src/errors/app-error.js');
    vi.spyOn(analysesService, 'createAnalysis').mockRejectedValue(
      new ServiceUnavailableError('Database is currently unavailable.')
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      payload: VALID_ANALYSIS_INPUT
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'SERVICE_UNAVAILABLE',
      message: 'Internal server error.',
      data: null
    });
  });
});

describe('GET /api/v1/analyses/:id — Endpoint 9', () => {
  it('returns HTTP 200 with analysis details and components', async () => {
    vi.spyOn(analysesService, 'getAnalysisById').mockResolvedValue(MOCK_ANALYSIS_DETAIL);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/analyses/${VALID_ANALYSIS_ID}`
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.data.id).toBe(VALID_ANALYSIS_ID);
    expect(json.data.metric_key).toBe('native_detections_v1');
    expect(json.data.grid_id).toBeNull();
    expect(json.data.data_mode).toBe('standard_only');
    expect(json.data.components).toHaveLength(2);
    expect(json.data.job.id).toBe(VALID_JOB_ID);
  });

  it('returns status partial when only the satellite component is ready and others incomplete', async () => {
    const partialDetail = {
      ...MOCK_ANALYSIS_DETAIL,
      analysis: {
        ...MOCK_ANALYSIS_DETAIL.analysis,
        status: 'partial'
      }
    };
    vi.spyOn(analysesService, 'getAnalysisById').mockResolvedValue(partialDetail);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/analyses/${VALID_ANALYSIS_ID}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('partial');
  });

  it('returns HTTP 404 when analysis does not exist', async () => {
    const { NotFoundError } = await import('../src/errors/app-error.js');
    vi.spyOn(analysesService, 'getAnalysisById').mockRejectedValue(
      new NotFoundError(`Analysis with id '00000000-0000-0000-0000-000000000000' was not found.`)
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/analyses/00000000-0000-0000-0000-000000000000'
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
  });
});

