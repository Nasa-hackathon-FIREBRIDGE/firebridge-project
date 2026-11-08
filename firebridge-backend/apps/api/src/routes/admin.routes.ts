import type { FastifyPluginAsync } from 'fastify';
import { adminController } from '../controllers/admin.controller.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get('/status', adminController.status);
  app.post('/refresh', adminController.refresh);
};
