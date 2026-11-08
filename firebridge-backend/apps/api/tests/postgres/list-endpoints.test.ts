import { disconnectDatabase } from '@firebridge/database';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { encodeCursor } from '../../src/utils/sources-cursor.js';

describe('GET /api/v1/areas & GET /api/v1/analyses (List APIs)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
    await disconnectRedis();
  });

  describe('GET /api/v1/areas', () => {
    it('returns HTTP 200 with areas list and pagination cursor in standard envelope', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/areas?limit=5'
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.message).toBe('Areas retrieved.');
      expect(Array.isArray(body.data.areas)).toBe(true);
      expect(body.data).toHaveProperty('nextCursor');

      if (body.data.areas.length > 0) {
        const area = body.data.areas[0];
        expect(area).toHaveProperty('id');
        expect(area).toHaveProperty('name');
        expect(area).toHaveProperty('version');
        expect(area).toHaveProperty('geometry');
      }
    });

    it('rejects invalid limit parameter with 400 INVALID_QUERY', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/areas?limit=0'
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.status).toBe('error');
      expect(body.code).toBe('INVALID_QUERY');
    });

    it('rejects tampered pagination cursor with 400 INVALID_CURSOR', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/areas?cursor=v1.invalidbase64.invalidsig'
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.status).toBe('error');
      expect(body.code).toBe('INVALID_CURSOR');
    });

    it('paginates deterministically using signed cursor', async () => {
      // First page
      const page1Response = await app.inject({
        method: 'GET',
        url: '/api/v1/areas?limit=1'
      });

      expect(page1Response.statusCode).toBe(200);
      const page1Body = page1Response.json();

      if (page1Body.data.nextCursor) {
        // Second page
        const page2Response = await app.inject({
          method: 'GET',
          url: `/api/v1/areas?limit=1&cursor=${page1Body.data.nextCursor}`
        });

        expect(page2Response.statusCode).toBe(200);
        const page2Body = page2Response.json();
        expect(page2Body.data.areas.length).toBeGreaterThanOrEqual(1);

        // Verify distinct items
        expect(page2Body.data.areas[0].id).not.toBe(page1Body.data.areas[0].id);
      }
    });
  });

  describe('GET /api/v1/analyses', () => {
    it('returns HTTP 200 with analyses list in standard envelope', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses?limit=5'
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.message).toBe('Analyses retrieved.');
      expect(Array.isArray(body.data.analyses)).toBe(true);
      expect(body.data).toHaveProperty('nextCursor');

      if (body.data.analyses.length > 0) {
        const analysis = body.data.analyses[0];
        expect(analysis).toHaveProperty('id');
        expect(analysis).toHaveProperty('status');
        expect(analysis).toHaveProperty('area_id');
        expect(analysis).toHaveProperty('metric_key');
        expect(analysis.data_mode).toBe('standard_only');
      }
    });

    it('filters by status correctly', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses?status=queued'
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
      for (const a of body.data.analyses) {
        expect(a.status).toBe('queued');
      }
    });

    it('rejects invalid status filter with 400 INVALID_QUERY', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analyses?status=not_a_valid_status'
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.status).toBe('error');
      expect(body.code).toBe('INVALID_QUERY');
    });

    it('enforces filter coherence on cursor (rejects cursor created for another status)', async () => {
      const cursorForQueued = encodeCursor({
        id: '00000000-0000-0000-0000-000000000001',
        filters: { status: 'queued' }
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/analyses?status=ready&cursor=${cursorForQueued}`
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.status).toBe('error');
      expect(body.code).toBe('INVALID_CURSOR');
    });
  });
});
