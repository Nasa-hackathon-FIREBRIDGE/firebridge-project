import type { FastifyPluginAsync } from 'fastify';
import { provenanceController } from '../controllers/provenance.controller.js';

export const provenanceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', provenanceController.list);
  fastify.get('/:id', provenanceController.getById);
};
