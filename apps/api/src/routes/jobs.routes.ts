import type { FastifyPluginAsync } from 'fastify';
import { jobsController } from '../controllers/jobs.controller.js';

export const jobsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', jobsController.list);
  app.get('/:jobId', jobsController.getById);
};
