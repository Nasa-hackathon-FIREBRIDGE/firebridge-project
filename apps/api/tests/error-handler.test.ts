import { testServer } from './helpers/http.js';
import request from './helpers/http.js';
import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  TooManyRequestsError
} from '../src/errors/app-error.js';

describe('errorHandler', () => {
  it('logs sanitized request fields without the error message or query string', async () => {
    const log = vi.fn();
    const app = testServer();
    app.get('/failure', async (req) => {
      req.log.error = log;
      throw new Error('sensitive database details');
    });
    await request(app).get('/failure?token=private-query');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        errorCode: 'INTERNAL_SERVER_ERROR',
        errorType: 'Error',
        method: 'GET',
        path: '/failure'
      }),
      'Request failed'
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive database details');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-query');
  });
  it('does not expose internal messages or pass invalid status codes to Fastify and returns 500 with code', async () => {
    const app = testServer();
    app.get('/failure', (_req, _res) => {
      throw Object.assign(new Error('sensitive database details'), { statusCode: 700 });
    });

    const response = await request(app).get('/failure');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
      data: null
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive database details');
  });

  it('handles 400 BadRequestError correctly with code and operational message', async () => {
    const app = testServer();
    app.get('/bad-request', (_req, _res) => {
      throw new BadRequestError('Query parameter is invalid.', 'INVALID_QUERY');
    });

    const response = await request(app).get('/bad-request');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      status: 'error',
      code: 'INVALID_QUERY',
      message: 'Query parameter is invalid.',
      data: null
    });
  });

  it('handles 404 NotFoundError with correct status and code', async () => {
    const app = testServer();
    app.get('/not-found', (_req, _res) => {
      throw new NotFoundError('The requested source was not found.');
    });

    const response = await request(app).get('/not-found');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      status: 'error',
      code: 'NOT_FOUND',
      message: 'The requested source was not found.',
      data: null
    });
  });

  it('handles 409 ConflictError with correct status and code', async () => {
    const app = testServer();
    app.get('/conflict', (_req, _res) => {
      throw new ConflictError('Resource already exists.', 'CONFLICT');
    });

    const response = await request(app).get('/conflict');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      status: 'error',
      code: 'CONFLICT',
      message: 'Resource already exists.',
      data: null
    });
  });

  it('handles 429 TooManyRequestsError with correct status and code', async () => {
    const app = testServer();
    app.get('/rate-limit', (_req, _res) => {
      throw new TooManyRequestsError('Rate limit exceeded.');
    });

    const response = await request(app).get('/rate-limit');

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({
      status: 'error',
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded.',
      data: null
    });
  });
});
