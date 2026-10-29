import type { FastifyRequest, FastifyReply } from 'fastify';
import { plannedResponse } from '../utils/planned-response.js';

export const tilesController = {
  list: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Tile listing is not implemented yet.')),
  getById: (_req: FastifyRequest, res: FastifyReply) =>
    res.status(501).send(plannedResponse('Tile detail lookup is not implemented yet.'))
};
