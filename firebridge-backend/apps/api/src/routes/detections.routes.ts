import type { FastifyPluginAsync } from 'fastify';
import { detectionsController } from '../controllers/detections.controller.js';

export const detectionsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', detectionsController.list);
  app.post('/', detectionsController.create);
};
