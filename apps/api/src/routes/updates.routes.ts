import type { FastifyPluginAsync } from 'fastify';
import { updatesController } from '../controllers/updates.controller.js';

export const updatesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', updatesController.list);
  fastify.post('/', updatesController.create);
};
