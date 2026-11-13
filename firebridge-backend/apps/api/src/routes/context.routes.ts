import type { FastifyPluginAsync } from 'fastify';
import { querySchema, uuidProperty, successSchema } from './phase-one.schemas.js';
import { contextController } from '../controllers/context.controller.js';
import { explanationController } from '../controllers/explanation.controller.js';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const dates = { start_date: date, end_date_exclusive: date };
const page = {
  limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
  cursor: { type: 'string', minLength: 1, maxLength: 4096 }
};
const cell = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' };
export const contextRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
  });
  for (const [path, summary, query, handler] of [
    [
      'coverage',
      'Prepared observation coverage; unknown for native point-only data',
      querySchema({ ...dates, cell_id: cell }),
      contextController.coverage
    ],
    [
      'comparison',
      'Native source counts or an explicitly pinned validated experiment',
      querySchema({
        view: { type: 'string', enum: ['native_counts', 'common_response', 'withheld_reference'] },
        resolution: { type: 'string', enum: ['week', 'month'] }
      }),
      contextController.comparison
    ],
    [
      'weather',
      'Pinned historical/recent weather with exact record membership',
      querySchema({
        ...page,
        variables: { type: 'string', maxLength: 1024 },
        resolution: { type: 'string', enum: ['hour', 'day', 'period'] },
        context: { type: 'string', enum: ['historical', 'recent', 'both'] }
      }),
      contextController.weather
    ],
    [
      'reports',
      'Pinned reports with explicit review and candidate status',
      querySchema({
        ...page,
        relation: {
          type: 'string',
          enum: ['candidate', 'consistent', 'conflicting', 'unresolved', 'rejected']
        },
        review_status: { type: 'string', enum: ['unreviewed', 'reviewed', 'rejected'] }
      }),
      contextController.reports
    ]
  ] as const) {
    app.get<{ Params: { id: string } }>(
      `/analyses/:id/${path}`,
      {
        schema: {
          tags: ['Phase 6'],
          summary,
          params: querySchema({ id: uuidProperty }, ['id']),
          querystring: query,
          response: { 200: successSchema }
        }
      },
      handler
    );
  }
  app.get<{ Params: { id: string; cell_id: string } }>(
    '/analyses/:id/cells/:cell_id',
    {
      schema: {
        tags: ['Phase 6'],
        summary: 'Release-local cell observations with validated grid support',
        params: querySchema({ id: uuidProperty, cell_id: cell }, ['id', 'cell_id']),
        querystring: querySchema({ ...page, ...dates }),
        response: { 200: successSchema }
      }
    },
    contextController.cell
  );
  app.post<{ Params: { id: string } }>(
    '/analyses/:id/explanations',
    {
      schema: {
        tags: ['Phase 6'],
        summary: 'Freeze facts and queue a validated deterministic explanation',
        description:
          'No external AI provider is called. Freeform questions are retained but not answered by the factual template.',
        params: querySchema({ id: uuidProperty }, ['id']),
        body: querySchema({
          language: { type: 'string', enum: ['fr', 'en'] },
          question: { type: 'string', maxLength: 512 }
        }),
        headers: {
          type: 'object',
          properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 256 } }
        },
        response: { 200: successSchema, 202: successSchema }
      }
    },
    explanationController.create
  );
  app.get<{ Params: { id: string } }>(
    '/explanations/:id',
    {
      schema: {
        tags: ['Phase 6'],
        summary: 'Read only a validated explanation or explicit template fallback',
        params: querySchema({ id: uuidProperty }, ['id']),
        querystring: querySchema({}),
        response: { 200: successSchema }
      }
    },
    explanationController.getById
  );
};
