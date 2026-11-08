import type { FastifyPluginAsync } from 'fastify';
import { provenanceController } from '../controllers/provenance.controller.js';

export const provenanceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', provenanceController.list);
  app.get('/:id', provenanceController.getById);
};
