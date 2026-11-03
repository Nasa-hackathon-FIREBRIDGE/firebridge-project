import type { FastifyPluginAsync } from 'fastify';
import { updatesController } from '../controllers/updates.controller.js';
import type { UpdatesQuery } from '../services/catalog.service.js';
import { scopeProperty, uuidProperty, querySchema, successSchema } from './phase-one.schemas.js';

export const updatesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: UpdatesQuery }>(
    '/',
    {
      schema: {
        tags: ['Phase 1'],
        summary: 'Compare current aliases with a pinned release; never fetch providers',
        querystring: querySchema(
          {
            scope_key: scopeProperty,
            after_release_id: uuidProperty,
            component: { type: 'string', enum: ['satellite', 'weather', 'reports'] },
            alias: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_.:-]+$' }
          },
          ['scope_key']
        ),
        response: { 200: successSchema }
      }
    },
    updatesController.list
  );
};
