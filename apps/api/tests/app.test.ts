import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('FIREBRIDGE API', () => {
  it('exposes the health endpoint', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v1/health/live');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('firebridge-api');
  });
});
