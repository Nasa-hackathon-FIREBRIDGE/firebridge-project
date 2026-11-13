import type { FastifyPluginAsync } from 'fastify';
import { reportsController } from '../controllers/reports.controller.js';

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', reportsController.list);
  app.post('/', reportsController.create);
};
