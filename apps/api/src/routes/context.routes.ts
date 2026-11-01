import type { FastifyPluginAsync } from 'fastify';
import { querySchema, uuidProperty, successSchema } from './phase-one.schemas.js';
import {
  coverageQuery,
  cellQuery,
  comparisonQuery,
  weatherQuery,
  reportsQuery,
  explanationBody,
  parseContext
} from '../validators/context.validator.js';
import { defaultScopeResolver } from '../middleware/idempotency.js';
import { envelope } from '../utils/response.js';

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
  for (const [path, summary, query] of [
    [
      'coverage',
      'Prepared observation coverage; unknown for native point-only data',
      querySchema({ ...dates, cell_id: cell })
    ],
    [
      'comparison',
      'Native source counts or an explicitly pinned validated experiment',
      querySchema({
        view: { type: 'string', enum: ['native_counts', 'common_response', 'withheld_reference'] },
        resolution: { type: 'string', enum: ['week', 'month'] }
      })
    ],
    [
      'weather',
      'Pinned historical/recent weather with exact record membership',
      querySchema({
        ...page,
        variables: { type: 'string', maxLength: 1024 },
        resolution: { type: 'string', enum: ['hour', 'day', 'period'] },
        context: { type: 'string', enum: ['historical', 'recent', 'both'] }
      })
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
      })
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
      async (request) => {
        const id = request.params.id.toLowerCase(),
          scope = defaultScopeResolver(request),
          service = app.contextService;
        const data =
          path === 'coverage'
            ? await service.coverage(id, parseContext(coverageQuery, request.query))
            : path === 'comparison'
              ? await service.comparison(id, parseContext(comparisonQuery, request.query))
              : path === 'weather'
                ? await service.weather(id, parseContext(weatherQuery, request.query), scope)
                : await service.reports(id, parseContext(reportsQuery, request.query), scope);
        return envelope(request, data);
      }
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
    async (request) =>
      envelope(
        request,
        await app.contextService.cell(
          request.params.id.toLowerCase(),
          request.params.cell_id,
          parseContext(cellQuery, request.query),
          defaultScopeResolver(request)
        )
      )
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
    async (request, reply) => {
      const result = await app.explanationService.create(
        request.params.id.toLowerCase(),
        parseContext(explanationBody, request.body),
        defaultScopeResolver(request),
        request.headers['idempotency-key'] as string | undefined
      );
      return reply.code(result.statusCode).send(envelope(request, result.data));
    }
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
    async (request) =>
      envelope(
        request,
        await app.explanationService.get(
          request.params.id.toLowerCase(),
          defaultScopeResolver(request)
        )
      )
  );
};
