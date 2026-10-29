import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const weatherController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Weather listing is not implemented yet.')),
  getByLocation: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Weather detail lookup is not implemented yet.'))
};
