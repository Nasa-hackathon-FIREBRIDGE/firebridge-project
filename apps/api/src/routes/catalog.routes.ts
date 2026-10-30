import type { FastifyPluginAsync } from 'fastify';
import { catalogController } from '../controllers/catalog.controller.js';

export const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', catalogController.list);
  fastify.get('/:id', catalogController.getById);
};
