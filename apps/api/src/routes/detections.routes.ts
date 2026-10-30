import type { FastifyPluginAsync } from 'fastify';
import { detectionsController } from '../controllers/detections.controller.js';

export const detectionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', detectionsController.list);
  fastify.post('/', detectionsController.create);
};
