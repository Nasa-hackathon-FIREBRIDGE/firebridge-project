import type { FastifyPluginAsync } from 'fastify';
import { areasController } from '../controllers/areas.controller.js';

export const areasRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', areasController.list);
  fastify.post('/', areasController.create);
  fastify.get('/:area_id', areasController.getById);
};
