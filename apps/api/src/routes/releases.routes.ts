import type { FastifyPluginAsync } from 'fastify';
import { releasesController } from '../controllers/releases.controller.js';

export const releasesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', releasesController.list);
  fastify.get('/:id', releasesController.getById);
};
