import type { FastifyPluginAsync } from 'fastify';
import { analysesController } from '../controllers/analyses.controller.js';
import { resultsController } from '../controllers/results.controller.js';
import { prepareExport, prepareTile } from '../middleware/results-access.js';
import { idempotency } from '../middleware/idempotency.js';

export const analysesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', { schema: { tags: ['Analyses'], summary: 'List analyses' } }, analysesController.list);
  fastify.post('/', { schema: { tags: ['Analyses'], summary: 'Create or reuse an analysis' } }, analysesController.create);
  fastify.get('/:id', { schema: { tags: ['Analyses'], summary: 'Read an analysis' } }, analysesController.getById);
  fastify.get('/:id/tiles/:layer/:z/:x/:y.mvt', {
    schema: { tags: ['Phase 4'], summary: 'Detections MVT; UUID and XYZ validated with Zod' },
    preHandler: prepareTile
  }, resultsController.tile);
  const hooks = idempotency({ required: true });
  fastify.post('/:id/exports', {
    bodyLimit: 8192,
    schema: { tags: ['Phase 4'], summary: 'Queue a CSV, GeoJSON or Parquet export; Idempotency-Key required' },
    ...hooks,
    preHandler: [prepareExport, hooks.preHandler]
  }, resultsController.createExport);
};
