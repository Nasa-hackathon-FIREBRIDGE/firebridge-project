import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const provenanceController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Provenance listing is not implemented yet.')),
  getById: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Provenance detail lookup is not implemented yet.'))
};
