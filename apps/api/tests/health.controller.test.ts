/**
 * Unit tests for healthController.
 *
 * These tests exercise the controller directly by constructing lightweight
 * mock FastifyRequest/FastifyReply objects, avoiding any real HTTP server
 * binding (no listen). This keeps the suite runnable in network-restricted
 * environments and deterministic in CI.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
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

function makeReply() {
  const code = vi.fn();
  const send = vi.fn();
  const reply = { code, send } as unknown as FastifyReply;
  // Allow chaining: reply.code(200).send(...)
  code.mockReturnValue(reply);
  send.mockReturnValue(reply);
  return { reply, code, send };
}

function makeReq() {
  return {} as FastifyRequest;
}

// ---------------------------------------------------------------------------
// Liveness — GET /api/v1/health/live
// ---------------------------------------------------------------------------

describe('healthController.getLiveStatus', () => {
  it('returns HTTP 200 with the liveness payload', async () => {
    const payload = {
      status: 'ok' as const,
      service: 'firebridge-api',
      uptimeMs: 12345,
      timestamp: new Date().toISOString()
    };
    mocks.getLiveStatus.mockReturnValue(payload);

    const req = makeReq();
    const { reply, code, send } = makeReply();

    await healthController.getLiveStatus(req, reply);

    expect(mocks.getLiveStatus).toHaveBeenCalledOnce();
    expect(code).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith(payload);
  });

  it('does not call getReadiness, prisma, or redis', async () => {
    mocks.getLiveStatus.mockReturnValue({
      status: 'ok',
      service: 'firebridge-api',
      uptimeMs: 0,
      timestamp: new Date().toISOString()
    });
    mocks.getReadiness.mockReset();

    await healthController.getLiveStatus(makeReq(), makeReply().reply);

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

    const { reply, code, send } = makeReply();
    await healthController.getReadiness(makeReq(), reply);

    expect(code).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith(readyPayload);
  });

  it('returns HTTP 503 when a required dependency is unavailable', async () => {
    const errorPayload: ReadinessStatus = {
      status: 'error',
      service: 'firebridge-api',
      checks: { database: 'unavailable', redis: 'ready', workers: 'not_checked' },
      timestamp: new Date().toISOString()
    };
    mocks.getReadiness.mockResolvedValue(errorPayload);

    const { reply, code, send } = makeReply();
    await healthController.getReadiness(makeReq(), reply);

    expect(code).toHaveBeenCalledWith(503);
    expect(send).toHaveBeenCalledWith(errorPayload);
  });

  it('returns HTTP 503 when Redis is unavailable', async () => {
    const errorPayload: ReadinessStatus = {
      status: 'error',
      service: 'firebridge-api',
      checks: { database: 'ready', redis: 'unavailable', workers: 'not_checked' },
      timestamp: new Date().toISOString()
    };
    mocks.getReadiness.mockResolvedValue(errorPayload);

    const { reply, code } = makeReply();
    await healthController.getReadiness(makeReq(), reply);

    expect(code).toHaveBeenCalledWith(503);
  });

  it('propagates unexpected service exceptions to the Fastify error handler without exposing them in the response', async () => {
    const internalError = new Error('private connection string: postgres://user:pass@host');
    mocks.getReadiness.mockRejectedValue(internalError);

    const { reply, code, send } = makeReply();

    // Fastify 5 routes a rejected async handler to the error handler (replaces next(error)).
    // The raw error must be rethrown unchanged so the centralized handler can sanitize it.
    await expect(healthController.getReadiness(makeReq(), reply)).rejects.toBe(internalError);

    // The controller must NOT write the response; the error handler does that.
    expect(code).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not call getLiveStatus', async () => {
    mocks.getReadiness.mockResolvedValue({
      status: 'ok',
      service: 'firebridge-api',
      checks: { database: 'ready', redis: 'ready', workers: 'not_checked' },
      timestamp: new Date().toISOString()
    });
    mocks.getLiveStatus.mockReset();

    await healthController.getReadiness(makeReq(), makeReply().reply);

    expect(mocks.getLiveStatus).not.toHaveBeenCalled();
  });
});