import type { FastifyPluginAsync } from 'fastify';
import { sourcesController } from '../controllers/sources.controller.js';
import { idempotency } from '../middleware/idempotency.js';

export const sourcesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { schema: { tags: ['Sources'], summary: 'List registered sources' } },
    sourcesController.list
  );
  app.post(
    '/',
    {
      ...idempotency({ required: false }),
      schema: { tags: ['Sources'], summary: 'Create a source' }
    },
    sourcesController.create
  );
};
