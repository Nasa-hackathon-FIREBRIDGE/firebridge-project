import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../errors/app-error.js';

const analysisId = { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' } as const;
const sessionId = { type: 'string', pattern: '^[0-9a-f]{32}$' } as const;
// Model calls are costly: tighter than the API-wide limit (applies where rate limiting is enabled).
const limited = { rateLimit: { max: 20, timeWindow: '1 minute' } } as const;
const language = { type: 'string', pattern: '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$' } as const;

/**
 * Browser access to the FireBridge AI Agent: load an analysis (with the sensor-bridge report the
 * browser computed), read its summary, and hold a conversation. Browser users get an anonymous
 * `web-<uuid>` identity, so they can neither read nor write other users' long-term memories;
 * memory administration and session listings stay with trusted server clients.
 */
export const explainerRoutes: FastifyPluginAsync = async (app) => {
  const agent = app.explainerService;

  app.get('/status', async () => ({ data: await agent.status() }));

  app.post(
    '/analyses',
    {
      config: limited,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['analysis_id'],
          properties: { analysis_id: analysisId, report: { type: 'object' } }
        }
      }
    },
    async (request) => {
      const body = request.body as { analysis_id: string; report?: Record<string, unknown> };
      const data = await agent.call('POST', '/v1/analyses', { analysis_id: body.analysis_id, report: body.report ?? null, use_api: true });
      return { data };
    }
  );

  app.get(
    '/analyses/:analysisId',
    { schema: { params: { type: 'object', required: ['analysisId'], properties: { analysisId: analysisId } } } },
    async (request) => {
      const { analysisId: id } = request.params as { analysisId: string };
      // "Not loaded yet" is an ordinary answer here, not an error the browser should log.
      try {
        return { data: await agent.call('GET', `/v1/analyses/${id}`) };
      } catch (error) {
        if (error instanceof AppError && error.code === 'EXPLAINER_NOT_FOUND') return { data: { analysis_id: id, title: '', sources: [], facts: [] } };
        throw error;
      }
    }
  );

  app.post(
    '/analyses/:analysisId/summary',
    {
      config: limited,
      schema: {
        params: { type: 'object', required: ['analysisId'], properties: { analysisId: analysisId } },
        body: { type: 'object', additionalProperties: false, properties: { language, refresh: { type: 'boolean' } } }
      }
    },
    async (request) => {
      const { analysisId: id } = request.params as { analysisId: string };
      const body = (request.body ?? {}) as { language?: string; refresh?: boolean };
      return { data: await agent.call('POST', `/v1/analyses/${id}/summary`, { language: body.language ?? 'en', refresh: body.refresh ?? false }) };
    }
  );

  app.post(
    '/sessions',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['analysis_id', 'client_id'],
          properties: { analysis_id: analysisId, client_id: { type: 'string', pattern: '^[0-9a-f-]{36}$' }, language }
        }
      }
    },
    async (request, reply) => {
      const body = request.body as { analysis_id: string; client_id: string; language?: string };
      const data = await agent.call('POST', '/v1/sessions', { analysis_id: body.analysis_id, user_id: `web-${body.client_id}`, language: body.language ?? 'en' });
      reply.code(201);
      return { data };
    }
  );

  app.get(
    '/sessions/:sessionId',
    { schema: { params: { type: 'object', required: ['sessionId'], properties: { sessionId } } } },
    async (request) => {
      const { sessionId: id } = request.params as { sessionId: string };
      return { data: await agent.call('GET', `/v1/sessions/${id}`) };
    }
  );

  app.post(
    '/sessions/:sessionId/messages',
    {
      config: limited,
      schema: {
        params: { type: 'object', required: ['sessionId'], properties: { sessionId } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 2000 },
            context: {
              type: 'object',
              additionalProperties: false,
              properties: {
                view: { type: 'string', pattern: '^[a-z0-9-]{0,40}$' },
                label: { type: 'string', maxLength: 160 },
                month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' }
              }
            }
          }
        }
      }
    },
    async (request) => {
      const { sessionId: id } = request.params as { sessionId: string };
      return { data: await agent.call('POST', `/v1/sessions/${id}/messages`, request.body) };
    }
  );
};
