import type { FastifyPluginAsync } from 'fastify';
import { sourcesController } from '../controllers/sources.controller.js';

export const sourcesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', sourcesController.list);
  app.post('/', sourcesController.create);
};
