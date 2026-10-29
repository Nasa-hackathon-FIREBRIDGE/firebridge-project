import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const analysesController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Analysis listing is not implemented yet.')),
  create: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Analysis creation is not implemented yet.'))
};
