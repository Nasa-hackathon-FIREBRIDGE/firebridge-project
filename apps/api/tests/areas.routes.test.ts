/**
 * POST /api/v1/areas — unit / route tests (Fastify-native, no real database)
 *
 * All database calls are mocked through the service layer.
 * PostGIS integration tests require a live database (see requirements §6).
 *
 * Pattern follows sources.routes.test.ts exactly:
 *   - legacyExpress: false  (Fastify inject() can't capture Express-written bodies)
 *   - vi.spyOn on the service
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { areasService } from '../src/services/areas.service.js';

type App = Awaited<ReturnType<typeof createApp>>;

const apps: App[] = [];

async function buildApp(): Promise<App> {
  const app = await createApp({ logger: false });
  await app.ready();
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A minimal valid GeoJSON Polygon (simple convex quadrilateral over southern France).
 * Coordinates are [longitude, latitude].
 */
const VALID_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [2.0, 43.0],
      [3.0, 43.0],
      [3.0, 44.0],
      [2.0, 44.0],
      [2.0, 43.0] // closed
    ]
  ]
};

/** Valid minimal POST body. */
const VALID_BODY = {
  geometry: VALID_POLYGON,
  name: 'Test AOI',
  version: 'v1',
  display_timezone: 'Europe/Paris',
  provenance: 'unit-test'
};

/** A representative AreaRecord as returned by the service. */
const AREA_RECORD = {
  area: {
    id: 'test-area-uuid-1',
    name: 'Test AOI',
    version: 'v1',
    geometry_sha256: 'abc123',
    display_timezone: 'Europe/Paris',
    provenance: 'unit-test',
    created_at: new Date('2026-10-30T00:00:00.000Z'),
    geom_geojson: JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [[[[2.0, 43.0], [3.0, 43.0], [3.0, 44.0], [2.0, 44.0], [2.0, 43.0]]]]
    })
  },
  created: true
};

// ─── POST /api/v1/areas — valid inputs ───────────────────────────────────────

describe('POST /api/v1/areas — valid inputs', () => {
  it('returns HTTP 201 with area data for a valid simple polygon', async () => {
    const create = vi.spyOn(areasService, 'createArea').mockResolvedValue(AREA_RECORD);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: VALID_BODY
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: 'ok',
      message: 'Area created.',
      data: {
        id: 'test-area-uuid-1',
        name: 'Test AOI',
        version: 'v1',
        geometry_sha256: 'abc123',
        display_timezone: 'Europe/Paris',
        provenance: 'unit-test'
      }
    });
    expect(response.json().data.geometry).toBeDefined();
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(VALID_BODY);
  });

  it('returns HTTP 201 for a polygon with many vertices', async () => {
    vi.spyOn(areasService, 'createArea').mockResolvedValue(AREA_RECORD);

    // Generate a 100-vertex polygon (circle approximation)
    const n = 100;
    const ring: number[][] = Array.from({ length: n }, (_, i) => {
      const angle = (2 * Math.PI * i) / n;
      return [2.5 + Math.cos(angle) * 0.5, 43.5 + Math.sin(angle) * 0.5];
    });
    ring.push(ring[0]!); // close

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: { ...VALID_BODY, geometry: { type: 'Polygon', coordinates: [ring] } }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('ok');
  });

  it('returns HTTP 200 for a repeated equivalent request (idempotent reuse)', async () => {
    const existingArea = { ...AREA_RECORD, created: false };
    vi.spyOn(areasService, 'createArea').mockResolvedValue(existingArea);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: VALID_BODY
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      message: 'Equivalent area already exists.',
      data: { id: 'test-area-uuid-1' }
    });
  });

  it('accepts a polygon crossing the antimeridian (longitude > 180 convention)', async () => {
    vi.spyOn(areasService, 'createArea').mockResolvedValue(AREA_RECORD);

    // A polygon that straddles the antimeridian (Fiji area, using RFC 7946 §3.1.9 split style)
    const antimeridianPoly = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [178.0, -17.0],
          [180.0, -17.0],
          [180.0, -16.0],
          [178.0, -16.0],
          [178.0, -17.0]
        ]
      ]
    };

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: { ...VALID_BODY, geometry: antimeridianPoly }
    });

    // Schema allows [-180,180]; service/PostGIS performs further validation
    expect(response.statusCode).toBe(201);
  });
});

// ─── POST /api/v1/areas — invalid inputs ─────────────────────────────────────

describe('POST /api/v1/areas — invalid inputs', () => {
  it('returns HTTP 400 when geometry is missing', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: { name: 'No geometry', version: 'v1', display_timezone: 'UTC', provenance: 'test' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: 'Invalid area payload.',
      data: null
    });
  });

  it('returns HTTP 400 when coordinates array is empty', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        ...VALID_BODY,
        geometry: { type: 'Polygon', coordinates: [] }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when coordinates contain strings instead of numbers', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        ...VALID_BODY,
        geometry: {
          type: 'Polygon',
          coordinates: [[['not', 'a', 'number'], [3.0, 43.0], [3.0, 44.0], ['not', 'a', 'number']]]
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when longitude is out of range (> 180)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        ...VALID_BODY,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[200.0, 43.0], [3.0, 43.0], [3.0, 44.0], [200.0, 44.0], [200.0, 43.0]]
          ]
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when latitude is out of range (> 90)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        ...VALID_BODY,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[2.0, 95.0], [3.0, 95.0], [3.0, 44.0], [2.0, 44.0], [2.0, 95.0]]
          ]
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when the ring has too few vertices (< 4 positions)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        ...VALID_BODY,
        geometry: {
          type: 'Polygon',
          coordinates: [
            // Only 3 positions (should be minimum 4: 3 distinct + closing)
            [[2.0, 43.0], [3.0, 43.0], [2.0, 43.0]]
          ]
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when the ring has more than 10 000 positions', async () => {
    const ring: number[][] = Array.from({ length: 10_001 }, (_, i) => [
      2.0 + (i / 10_001) * 0.1,
      43.0 + (i / 10_001) * 0.1
    ]);
    ring.push(ring[0]!);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        ...VALID_BODY,
        geometry: { type: 'Polygon', coordinates: [ring] }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when the ring is not closed (first ≠ last)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        ...VALID_BODY,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[2.0, 43.0], [3.0, 43.0], [3.0, 44.0], [2.0, 44.0]] // not closed
          ]
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when NaN values appear in coordinates', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        ...VALID_BODY,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[NaN, 43.0], [3.0, 43.0], [3.0, 44.0], [NaN, 44.0], [NaN, 43.0]]
          ]
        }
      }
    });

    // NaN is not a valid JSON number; Fastify body parsing rejects it before schema
    expect([400, 415]).toContain(response.statusCode);
  });

  it('returns HTTP 400 when an unknown field is present in the body', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: { ...VALID_BODY, unknown_field: 'should be rejected' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when name is missing', async () => {
    const app = await buildApp();
    const bodyWithoutName: Record<string, unknown> = { ...VALID_BODY };
    delete bodyWithoutName.name;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: bodyWithoutName
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when geometry type is not Polygon', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: {
        ...VALID_BODY,
        geometry: {
          type: 'MultiPolygon', // only Polygon is accepted at the API boundary
          coordinates: [[[[2.0, 43.0], [3.0, 43.0], [3.0, 44.0], [2.0, 44.0], [2.0, 43.0]]]]
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when service rejects a self-intersecting polygon', async () => {
    const { BadRequestError } = await import('../src/errors/app-error.js');
    vi.spyOn(areasService, 'createArea').mockRejectedValue(
      new BadRequestError('Geometry is not valid (self-intersection detected).', 'VALIDATION_ERROR')
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: VALID_BODY
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().status).toBe('error');
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when service rejects a zero-area degenerate polygon', async () => {
    const { BadRequestError } = await import('../src/errors/app-error.js');
    vi.spyOn(areasService, 'createArea').mockRejectedValue(
      new BadRequestError('Geometry is empty or degenerate.', 'VALIDATION_ERROR')
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: VALID_BODY
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns HTTP 400 when service rejects an excessive surface area', async () => {
    const { BadRequestError } = await import('../src/errors/app-error.js');
    vi.spyOn(areasService, 'createArea').mockRejectedValue(
      new BadRequestError('Polygon surface area exceeds the maximum allowed.', 'VALIDATION_ERROR')
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: VALID_BODY
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });
});

// ─── POST /api/v1/areas — persistence and reliability ───────────────────────

describe('POST /api/v1/areas — persistence and reliability', () => {
  it('returns HTTP 201 with the persisted area on successful database write', async () => {
    vi.spyOn(areasService, 'createArea').mockResolvedValue(AREA_RECORD);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: VALID_BODY
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.id).toBe('test-area-uuid-1');
    expect(response.json().data.created_at).toBeDefined();
  });

  it('returns HTTP 200 and the existing area when an equivalent area is reused', async () => {
    vi.spyOn(areasService, 'createArea').mockResolvedValue({ ...AREA_RECORD, created: false });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: VALID_BODY
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().message).toBe('Equivalent area already exists.');
    expect(response.json().data.id).toBe('test-area-uuid-1');
  });

  it('returns HTTP 503 and a sanitized error when the database is unavailable', async () => {
    const { ServiceUnavailableError } = await import('../src/errors/app-error.js');
    vi.spyOn(areasService, 'createArea').mockRejectedValue(
      new ServiceUnavailableError('Database is currently unavailable.')
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: VALID_BODY
    });

    expect(response.statusCode).toBe(503);
    // The error-handler sanitizes all 5xx messages to 'Internal server error.'
    // regardless of the AppError.message, consistent with existing API conventions
    // (see sources.routes.test.ts and the error-handler implementation).
    expect(response.json()).toMatchObject({
      status: 'error',
      code: 'SERVICE_UNAVAILABLE',
      message: 'Internal server error.',
      data: null
    });
  });

  it('does not expose SQL errors, connection strings, or internal stack traces', async () => {
    vi.spyOn(areasService, 'createArea').mockRejectedValue(
      new Error('relation "firebridge"."areas" does not exist — internal PostgreSQL detail')
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      payload: VALID_BODY
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
      data: null
    });

    const responseText = JSON.stringify(response.json());
    expect(responseText).not.toContain('firebridge');
    expect(responseText).not.toContain('PostgreSQL');
    expect(responseText).not.toContain('internal detail');
    expect(responseText).not.toContain('relation');
  });

  it('calls the service exactly once per request (no silent retries)', async () => {
    const create = vi.spyOn(areasService, 'createArea').mockResolvedValue(AREA_RECORD);

    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/api/v1/areas', payload: VALID_BODY });

    expect(create).toHaveBeenCalledOnce();
  });
});

// ─── GET /api/v1/areas/:area_id — Endpoint 7 ────────────────────────────────

describe('GET /api/v1/areas/:area_id', () => {
  const detailWithoutGrid = {
    id: 'test-area-uuid-1',
    name: 'Test AOI',
    version: 'v1',
    geometry_sha256: 'abc123',
    display_timezone: 'Europe/Paris',
    provenance: 'unit-test',
    created_at: new Date('2026-10-30T00:00:00.000Z'),
    geom_geojson: JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [[[[2.0, 43.0], [3.0, 43.0], [3.0, 44.0], [2.0, 44.0], [2.0, 43.0]]]]
    }),
    surface_km2: 8985.39,
    weights_status: 'not_prepared' as const,
    cells_count: 0,
    total_overlap_land_area_m2: 0,
    grid: null
  };

  const detailWithGrid = {
    ...detailWithoutGrid,
    weights_status: 'prepared' as const,
    cells_count: 42,
    total_overlap_land_area_m2: 5000000,
    grid: {
      id: 'grid-global-1km',
      version: 'v1',
      cell_size_m: 1000
    }
  };

  it('returns HTTP 200 with area details and weights_status=not_prepared when area has no grid cells', async () => {
    vi.spyOn(areasService, 'getAreaById').mockResolvedValue(detailWithoutGrid);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/areas/test-area-uuid-1'
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.message).toBe('Area retrieved.');
    expect(json.data.id).toBe('test-area-uuid-1');
    expect(json.data.surface_km2).toBe(8985.39);
    expect(json.data.coverage.weights_status).toBe('not_prepared');
    expect(json.data.coverage.cells_count).toBe(0);
    expect(json.data.coverage.grid).toBeNull();
  });

  it('returns HTTP 200 with grid and cell info when weights are prepared', async () => {
    vi.spyOn(areasService, 'getAreaById').mockResolvedValue(detailWithGrid);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/areas/test-area-uuid-1'
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data.coverage.weights_status).toBe('prepared');
    expect(json.data.coverage.cells_count).toBe(42);
    expect(json.data.coverage.grid).toEqual({
      id: 'grid-global-1km',
      version: 'v1',
      cell_size_m: 1000
    });
  });

  it('returns HTTP 404 when area does not exist', async () => {
    const { NotFoundError } = await import('../src/errors/app-error.js');
    vi.spyOn(areasService, 'getAreaById').mockRejectedValue(
      new NotFoundError("Area with id '00000000-0000-0000-0000-000000000000' was not found.")
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/areas/00000000-0000-0000-0000-000000000000'
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      status: 'error',
      code: 'NOT_FOUND',
      message: "Area with id '00000000-0000-0000-0000-000000000000' was not found.",
      data: null
    });
  });
});

// ─── Existing routes not broken ───────────────────────────────────────────────

describe('Existing endpoints are unaffected', () => {
  it('GET /api/v1/sources still returns HTTP 200 after areas route registration', async () => {
    const { sourcesService } = await import('../src/services/sources.service.js');
    vi.spyOn(sourcesService, 'list').mockResolvedValue({ sources: [], nextCursor: null });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources' });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('GET /api/v1/health/live still returns HTTP 200', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });
});
