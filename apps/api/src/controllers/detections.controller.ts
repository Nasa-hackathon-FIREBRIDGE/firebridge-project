import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const detectionsController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Detection listing is not implemented yet.')),
  create: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Detection creation is not implemented yet.'))
};
