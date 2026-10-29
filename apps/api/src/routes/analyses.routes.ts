import type { FastifyPluginAsync } from 'fastify';
import { analysesController } from '../controllers/analyses.controller.js';

export const analysesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', analysesController.list);
  app.post('/', analysesController.create);
};
