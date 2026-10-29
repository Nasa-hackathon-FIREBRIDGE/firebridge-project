import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';

describe('errorHandler', () => {
  it('does not expose internal messages or pass invalid status codes to Express', async () => {
    const app = express();
    app.get('/failure', (_req, _res, next) => {
      next(Object.assign(new Error('sensitive database details'), { statusCode: 700 }));
    });
    app.use(errorHandler);

    const response = await request(app).get('/failure');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      status: 'error',
      message: 'Internal server error.',
      data: null
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive database details');
  });
});
