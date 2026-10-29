import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const jobsController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Job listing is not implemented yet.')),
  getById: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Job detail lookup is not implemented yet.'))
};
