import type { FastifyPluginAsync } from 'fastify';
import { jobsController } from '../controllers/jobs.controller.js';

export const jobsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', jobsController.list);
  fastify.get('/:id', jobsController.getById);
};
