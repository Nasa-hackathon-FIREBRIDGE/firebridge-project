import type { FastifyPluginAsync } from 'fastify';
import { adminController } from '../controllers/admin.controller.js';

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/status', adminController.status);
  fastify.post('/refresh', adminController.refresh);
};
