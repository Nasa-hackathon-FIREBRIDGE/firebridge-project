/**
 * Unit tests for healthController.
 *
 * These tests exercise the controller directly by constructing lightweight
 * mock Request/Response/NextFunction objects, avoiding any real HTTP server
 * binding (no supertest, no listen). This keeps the suite runnable in network-
 * restricted environments and deterministic in CI.
 */
import { describe, expect, it, vi, type MockedFunction } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { ReadinessStatus } from '../src/types/api.js';

// ---------------------------------------------------------------------------
// Hoist mocks before any module imports that reference the mocked modules.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getLiveStatus: vi.fn(),
  getReadiness: vi.fn()
}));

vi.mock('../src/services/health.service.js', () => ({
  healthService: {
    getLiveStatus: mocks.getLiveStatus,
    getReadiness: mocks.getReadiness
  }
}));

import { healthController } from '../src/controllers/health.controller.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn()
  } as unknown as Response;
  // Allow chaining: res.status(200).json(...)
  (res.status as MockedFunction<Response['status']>).mockReturnValue(res);
  return res;
}

function makeReq() {
  return {} as Request;
}

function makeNext() {
  return vi.fn() as unknown as NextFunction;
}

// ---------------------------------------------------------------------------
// Liveness — GET /api/v1/health/live
// ---------------------------------------------------------------------------

describe('healthController.getLiveStatus', () => {
  it('returns HTTP 200 with the liveness payload', () => {
    const payload = {
      status: 'ok' as const,
      service: 'firebridge-api',
      uptimeMs: 12345,
      timestamp: new Date().toISOString()
    };
    mocks.getLiveStatus.mockReturnValue(payload);

    const req = makeReq();
    const res = makeRes();

    healthController.getLiveStatus(req, res);

    expect(mocks.getLiveStatus).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('does not call getReadiness, prisma, or redis', () => {
    mocks.getLiveStatus.mockReturnValue({
      status: 'ok',
      service: 'firebridge-api',
      uptimeMs: 0,
      timestamp: new Date().toISOString()
    });
    mocks.getReadiness.mockReset();

    healthController.getLiveStatus(makeReq(), makeRes());

    expect(mocks.getReadiness).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Readiness — GET /api/v1/health/ready
// ---------------------------------------------------------------------------

describe('healthController.getReadiness', () => {
  it('returns HTTP 200 when all required readiness conditions succeed', async () => {
    const readyPayload: ReadinessStatus = {
      status: 'ok',
      service: 'firebridge-api',
      checks: { database: 'ready', redis: 'ready', workers: 'not_checked' },
      timestamp: new Date().toISOString()
    };
    mocks.getReadiness.mockResolvedValue(readyPayload);

    const res = makeRes();
    await healthController.getReadiness(makeReq(), res, makeNext());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(readyPayload);
  });

  it('returns HTTP 503 when a required dependency is unavailable', async () => {
    const errorPayload: ReadinessStatus = {
      status: 'error',
      service: 'firebridge-api',
      checks: { database: 'unavailable', redis: 'ready', workers: 'not_checked' },
      timestamp: new Date().toISOString()
    };
    mocks.getReadiness.mockResolvedValue(errorPayload);

    const res = makeRes();
    await healthController.getReadiness(makeReq(), res, makeNext());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(errorPayload);
  });

  it('returns HTTP 503 when Redis is unavailable', async () => {
    const errorPayload: ReadinessStatus = {
      status: 'error',
      service: 'firebridge-api',
      checks: { database: 'ready', redis: 'unavailable', workers: 'not_checked' },
      timestamp: new Date().toISOString()
    };
    mocks.getReadiness.mockResolvedValue(errorPayload);

    const res = makeRes();
    await healthController.getReadiness(makeReq(), res, makeNext());

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('forwards unexpected service exceptions to next() without exposing them in the response', async () => {
    const internalError = new Error('private connection string: postgres://user:pass@host');
    mocks.getReadiness.mockRejectedValue(internalError);

    const res = makeRes();
    const next = makeNext();
    await healthController.getReadiness(makeReq(), res, next);

    // The controller must NOT write the response; the error handler does that.
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    // The raw error is forwarded to next() so the centralized handler can sanitize it.
    expect(next).toHaveBeenCalledWith(internalError);
  });

  it('does not call getLiveStatus', async () => {
    mocks.getReadiness.mockResolvedValue({
      status: 'ok',
      service: 'firebridge-api',
      checks: { database: 'ready', redis: 'ready', workers: 'not_checked' },
      timestamp: new Date().toISOString()
    });
    mocks.getLiveStatus.mockReset();

    await healthController.getReadiness(makeReq(), makeRes(), makeNext());

    expect(mocks.getLiveStatus).not.toHaveBeenCalled();
  });
});

