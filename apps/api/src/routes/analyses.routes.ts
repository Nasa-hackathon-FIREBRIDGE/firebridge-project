import type { FastifyPluginAsync } from 'fastify';
import { analysesController } from '../controllers/analyses.controller.js';

export const analysesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', analysesController.list);
  fastify.post('/', analysesController.create);
  fastify.get('/:id', analysesController.getById);
};
