import type { FastifyPluginAsync } from 'fastify';
import { sourcesController } from '../controllers/sources.controller.js';
import { idempotency } from '../middleware/idempotency.js';

export const sourcesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', sourcesController.list);
  fastify.post('/', { ...idempotency({ required: false }) }, sourcesController.create);
};