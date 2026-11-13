import type { FastifyPluginAsync } from 'fastify';
import { cellsController } from '../controllers/cells.controller.js';

export const cellsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', cellsController.list);
  app.get('/:cellId', cellsController.getById);
};
