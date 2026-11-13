import type { FastifyPluginAsync } from 'fastify';
import { explanationsController } from '../controllers/explanations.controller.js';

export const explanationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', explanationsController.list);
  app.post('/', explanationsController.create);
};
