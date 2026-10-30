import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { logger } from '../src/config/logger.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  TooManyRequestsError
} from '../src/errors/app-error.js';

const apps: FastifyInstance[] = [];

function buildApp(register: (app: FastifyInstance) => void): FastifyInstance {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  register(app);
  apps.push(app);
  return app;
}

describe('errorHandler', () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.restoreAllMocks();
  });

  it('does not expose internal messages or pass invalid status codes to Fastify and returns 500 with code', async () => {
    const app = buildApp((instance) => {
      instance.get('/failure', async () => {
        throw Object.assign(new Error('sensitive database details'), { statusCode: 700 });
      });
    });

    const response = await app.inject({ method: 'GET', url: '/failure' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
      data: null
    });
    expect(JSON.stringify(response.json())).not.toContain('sensitive database details');
  });

  it('handles 400 BadRequestError correctly with code and operational message', async () => {
    const app = buildApp((instance) => {
      instance.get('/bad-request', async () => {
        throw new BadRequestError('Query parameter is invalid.', 'INVALID_QUERY');
      });
    });

    const response = await app.inject({ method: 'GET', url: '/bad-request' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'INVALID_QUERY',
      message: 'Query parameter is invalid.',
      data: null
    });
  });

  it('handles 404 NotFoundError with correct status and code', async () => {
    const app = buildApp((instance) => {
      instance.get('/not-found', async () => {
        throw new NotFoundError('The requested source was not found.');
      });
    });

    const response = await app.inject({ method: 'GET', url: '/not-found' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'NOT_FOUND',
      message: 'The requested source was not found.',
      data: null
    });
  });

  it('handles 409 ConflictError with correct status and code', async () => {
    const app = buildApp((instance) => {
      instance.get('/conflict', async () => {
        throw new ConflictError('Resource already exists.', 'CONFLICT');
      });
    });

    const response = await app.inject({ method: 'GET', url: '/conflict' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'CONFLICT',
      message: 'Resource already exists.',
      data: null
    });
  });

  it('handles 429 TooManyRequestsError with correct status and code', async () => {
    const app = buildApp((instance) => {
      instance.get('/rate-limit', async () => {
        throw new TooManyRequestsError('Rate limit exceeded.');
      });
    });

    const response = await app.inject({ method: 'GET', url: '/rate-limit' });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      status: 'error',
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded.',
      data: null
    });
  });

  // Added to cover the logging behavior preserved by the migration.
  it('logs only sanitized fields and never the error message or the query string', async () => {
    const errorLog = vi.spyOn(logger, 'error');
    const app = buildApp((instance) => {
      instance.get('/failure', async () => {
        throw new Error('sensitive database details');
      });
    });

    await app.inject({ method: 'GET', url: '/failure?token=secret-query-value' });

    expect(errorLog).toHaveBeenCalledWith(
      {
        statusCode: 500,
        errorCode: 'INTERNAL_SERVER_ERROR',
        errorType: 'Error',
        method: 'GET',
        path: '/failure'
      },
      'Request failed'
    );
    const serialisedCalls = JSON.stringify(errorLog.mock.calls);
    expect(serialisedCalls).not.toContain('sensitive database details');
    expect(serialisedCalls).not.toContain('secret-query-value');
  });
});