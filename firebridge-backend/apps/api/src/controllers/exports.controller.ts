import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const exportsController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Export listing is not implemented yet.')),
  create: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Export creation is not implemented yet.'))
};
