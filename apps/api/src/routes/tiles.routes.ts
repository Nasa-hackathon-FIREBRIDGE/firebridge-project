import type { FastifyPluginAsync } from 'fastify';
import { tilesController } from '../controllers/tiles.controller.js';

export const tilesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', tilesController.list);
  app.get('/:tileId', tilesController.getById);
};
