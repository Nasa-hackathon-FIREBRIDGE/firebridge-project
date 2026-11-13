import type { FastifyPluginAsync } from 'fastify';
import { ingestionAdmin } from '../middleware/ingestion-admin.js';
import { ingestionController } from '../controllers/ingestion.controller.js';
import { querySchema, scopeProperty, uuidProperty, successSchema } from './phase-one.schemas.js';

const time = { type: 'string', minLength: 20, maxLength: 24 };
const identifier = scopeProperty;
const budget = querySchema(
  {
    max_chunks: { type: 'integer', minimum: 1, maximum: 366 },
    max_bytes: { type: 'integer', minimum: 1, maximum: 1_000_000_000_000 }
  },
  ['max_chunks', 'max_bytes']
);
const pagination = {
  limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$' },
  cursor: { type: 'string', minLength: 1, maxLength: 4096 }
};
const adminSchema = {
  tags: ['Phase 5'],
  security: [{ ingestionAdmin: [] }],
  response: { 200: successSchema }
};
const headers = {
  type: 'object',
  properties: {
    'idempotency-key': {
      type: 'string',
      minLength: 8,
      maxLength: 128,
      pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    }
  }
};

export const ingestionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });
  // Scope the operational authentication hook to these five administrative routes.
  app.register(
    async (admin) => {
      admin.addHook('onRequest', async (request) => {
        ingestionAdmin(request, app.ingestionAdminToken);
      });
      admin.get(
        '/subscriptions',
        {
          schema: {
            ...adminSchema,
            summary: 'List ingestion subscriptions without contacting providers',
            querystring: querySchema({
              ...pagination,
              scope_key: identifier,
              feed_id: identifier,
              mode: { type: 'string', enum: ['backfill', 'incremental', 'reconciliation'] },
              state: { type: 'string', enum: ['active', 'paused', 'retired', 'unverified'] },
              enabled: { type: 'string', enum: ['true', 'false'] }
            })
          }
        },
        ingestionController.subscriptions
      );
      admin.get(
        '/gaps',
        {
          schema: {
            ...adminSchema,
            summary: 'List source ingestion gaps; clouds are not transport gaps',
            querystring: querySchema({
              ...pagination,
              scope_key: identifier,
              feed_id: identifier,
              status: {
                type: 'string',
                enum: ['open', 'retrying', 'resolved', 'accepted_unavailable']
              },
              start: time,
              end_exclusive: time
            })
          }
        },
        ingestionController.gaps
      );
      admin.get<{ Params: { id: string } }>(
        '/runs/:id',
        {
          schema: {
            ...adminSchema,
            summary: 'Inspect a fetch attempt with sanitized evidence',
            params: querySchema({ id: uuidProperty }, ['id']),
            querystring: querySchema({})
          }
        },
        ingestionController.run
      );
      admin.post(
        '/backfills',
        {
          schema: {
            ...adminSchema,
            summary: 'Queue a bounded ingestion plan atomically; no synchronous fetch',
            description:
              'Planning-only delivery: provider execution and publication require an ingestion adapter. Unknown byte estimates remain null.',
            headers,
            response: { 200: successSchema, 202: successSchema },
            body: querySchema(
              {
                feed_id: identifier,
                area_id: uuidProperty,
                scope_key: identifier,
                start: time,
                end_exclusive: time,
                source_ids: { type: 'array', minItems: 1, maxItems: 100, items: identifier },
                products: { type: 'array', minItems: 1, maxItems: 100, items: identifier },
                collection: { type: 'string', minLength: 1, maxLength: 64 },
                adapter_options: querySchema({}),
                resource_budget: budget
              },
              [
                'feed_id',
                'area_id',
                'scope_key',
                'start',
                'end_exclusive',
                'source_ids',
                'products',
                'collection',
                'resource_budget'
              ]
            )
          }
        },
        ingestionController.backfill
      );
      admin.post<{ Params: { id: string } }>(
        '/subscriptions/:id/refresh',
        {
          schema: {
            ...adminSchema,
            summary: 'Queue a bounded poll, repair or reconcile plan',
            headers,
            params: querySchema({ id: uuidProperty }, ['id']),
            response: { 200: successSchema, 202: successSchema },
            body: querySchema(
              {
                mode: { type: 'string', enum: ['poll', 'repair', 'reconcile'] },
                start: time,
                end_exclusive: time,
                reason: { type: 'string', enum: ['manual', 'gap_repair', 'provider_revision'] },
                resource_budget: budget
              },
              ['mode', 'resource_budget']
            )
          }
        },
        ingestionController.refresh
      );
    },
    { prefix: '/admin/ingestion' }
  );

  app.get<{ Params: { source_id: string } }>(
    '/sources/:source_id/availability',
    {
      schema: {
        tags: ['Phase 5'],
        summary: 'Source-specific provider status, committed boundaries and ingestion gaps',
        params: querySchema({ source_id: identifier }, ['source_id']),
        querystring: querySchema({ scope_key: identifier, start: time, end_exclusive: time }, [
          'scope_key'
        ]),
        response: { 200: successSchema }
      }
    },
    ingestionController.availability
  );
};
