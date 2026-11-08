import type { FastifyPluginAsync } from 'fastify';
import { releasesController } from '../controllers/releases.controller.js';
import type { ReleaseQuery } from '../services/catalog.service.js';
import { uuidProperty, querySchema, successSchema } from './phase-one.schemas.js';

export const releasesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { release_id: string }; Querystring: ReleaseQuery }>(
    '/:release_id',
    {
      schema: {
        tags: ['Phase 1'],
        summary: 'Exact published release with signed membership pagination',
        params: querySchema({ release_id: uuidProperty }, ['release_id']),
        querystring: querySchema({
          membership: { type: 'string', enum: ['partitions', 'assets'] },
          limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$', default: '50' },
          cursor: { type: 'string', minLength: 1, maxLength: 4096 }
        }),
        response: { 200: successSchema }
      }
    },
    releasesController.getById
  );
};
