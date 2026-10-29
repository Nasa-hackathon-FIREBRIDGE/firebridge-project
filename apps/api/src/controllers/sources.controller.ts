import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const sourcesController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Source listing is not implemented yet.')),
  create: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Source creation is not implemented yet.'))
};
