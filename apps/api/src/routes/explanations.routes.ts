import type { FastifyPluginAsync } from 'fastify';
import { explanationsController } from '../controllers/explanations.controller.js';

export const explanationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', explanationsController.list);
  fastify.post('/', explanationsController.create);
};
