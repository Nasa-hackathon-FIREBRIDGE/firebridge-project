import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const cellsController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Cell listing is not implemented yet.')),
  getById: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Cell detail lookup is not implemented yet.'))
};
