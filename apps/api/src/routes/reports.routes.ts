import type { FastifyPluginAsync } from 'fastify';
import { reportsController } from '../controllers/reports.controller.js';

export const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', reportsController.list);
  fastify.post('/', reportsController.create);
};
