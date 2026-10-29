import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const areasController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Area listing is not implemented yet.')),
  getById: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Area detail lookup is not implemented yet.'))
};
