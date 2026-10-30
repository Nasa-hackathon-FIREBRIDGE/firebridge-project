import type { FastifyPluginAsync } from 'fastify';
import { tilesController } from '../controllers/tiles.controller.js';

export const tilesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', tilesController.list);
  fastify.get('/:tileId', tilesController.getById);
};
