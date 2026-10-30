import type { FastifyPluginAsync } from 'fastify';
import { exportsController } from '../controllers/exports.controller.js';

export const exportsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', exportsController.list);
  fastify.post('/', exportsController.create);
};
