import type { FastifyPluginAsync } from 'fastify';
import { areasController } from '../controllers/areas.controller.js';

export const areasRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', areasController.list);
  app.get('/:areaId', areasController.getById);
};
