import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const adminController = {
  status: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Administrative status is not implemented yet.')),
  refresh: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Administrative refresh action is not implemented yet.'))
};
