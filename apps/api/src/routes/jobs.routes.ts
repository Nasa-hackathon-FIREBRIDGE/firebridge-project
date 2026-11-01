import type { FastifyPluginAsync } from 'fastify';
import { jobsController } from '../controllers/jobs.controller.js';
import { resultsController } from '../controllers/results.controller.js';

export const jobsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', { schema: { tags: ['Jobs'], summary: 'List jobs' } }, jobsController.list);
  fastify.get('/:id', { schema: { tags: ['Jobs'], summary: 'Read a job' } }, jobsController.getById);
  fastify.get('/:id/download', {
    schema: { tags: ['Phase 4'], summary: 'Stream a completed export; 409 pending, 410 expired' }
  }, resultsController.download);
};
