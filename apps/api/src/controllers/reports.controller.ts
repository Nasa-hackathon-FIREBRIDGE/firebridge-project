import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const reportsController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Report listing is not implemented yet.')),
  create: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Report creation is not implemented yet.'))
};
