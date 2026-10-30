import type { FastifyPluginAsync } from 'fastify';
import { cellsController } from '../controllers/cells.controller.js';

export const cellsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', cellsController.list);
  fastify.get('/:cellId', cellsController.getById);
};
