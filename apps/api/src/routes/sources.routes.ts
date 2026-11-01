import type { FastifyPluginAsync } from 'fastify';
import { sourcesController } from '../controllers/sources.controller.js';
import { idempotency } from '../middleware/idempotency.js';

export const sourcesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', sourcesController.list);
  const hooks = idempotency({ required: false });
  fastify.post('/', { ...hooks, schema: { tags: ['Sources'], summary: 'Create a source' } }, sourcesController.create);
};
