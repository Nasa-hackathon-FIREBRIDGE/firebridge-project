import type { FastifyPluginAsync } from 'fastify';
import { healthController } from '../controllers/health.controller.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/live', healthController.getLiveStatus);
  fastify.get('/ready', healthController.getReadiness);
};