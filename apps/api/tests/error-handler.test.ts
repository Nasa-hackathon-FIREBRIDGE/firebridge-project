import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  TooManyRequestsError
} from '../src/errors/app-error.js';

describe('errorHandler', () => {
  it('does not expose internal messages or pass invalid status codes to Express and returns 500 with code', async () => {
    const app = express();
    app.get('/failure', (_req, _res, next) => {
      next(Object.assign(new Error('sensitive database details'), { statusCode: 700 }));
    });
    app.use(errorHandler);

    const response = await request(app).get('/failure');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      status: 'error',
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
      data: null
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive database details');
  });

  it('handles 400 BadRequestError correctly with code and operational message', async () => {
    const app = express();
    app.get('/bad-request', (_req, _res, next) => {
      next(new BadRequestError('Query parameter is invalid.', 'INVALID_QUERY'));
    });
    app.use(errorHandler);

    const response = await request(app).get('/bad-request');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: 'error',
      code: 'INVALID_QUERY',
      message: 'Query parameter is invalid.',
      data: null
    });
  });

  it('handles 404 NotFoundError with correct status and code', async () => {
    const app = express();
    app.get('/not-found', (_req, _res, next) => {
      next(new NotFoundError('The requested source was not found.'));
    });
    app.use(errorHandler);

    const response = await request(app).get('/not-found');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      status: 'error',
      code: 'NOT_FOUND',
      message: 'The requested source was not found.',
      data: null
    });
  });

  it('handles 409 ConflictError with correct status and code', async () => {
    const app = express();
    app.get('/conflict', (_req, _res, next) => {
      next(new ConflictError('Resource already exists.', 'CONFLICT'));
    });
    app.use(errorHandler);

    const response = await request(app).get('/conflict');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      status: 'error',
      code: 'CONFLICT',
      message: 'Resource already exists.',
      data: null
    });
  });

  it('handles 429 TooManyRequestsError with correct status and code', async () => {
    const app = express();
    app.get('/rate-limit', (_req, _res, next) => {
      next(new TooManyRequestsError('Rate limit exceeded.'));
    });
    app.use(errorHandler);

    const response = await request(app).get('/rate-limit');

    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      status: 'error',
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded.',
      data: null
    });
  });
});
