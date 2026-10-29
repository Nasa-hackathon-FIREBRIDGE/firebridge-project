import type { FastifyPluginAsync } from 'fastify';
import { healthController } from '../controllers/health.controller.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/live', healthController.getLiveStatus);
  app.get('/ready', healthController.getReadiness);
};
