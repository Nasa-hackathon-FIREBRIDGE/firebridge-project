import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UpdatesQuery } from '../services/catalog.service.js';
import { envelope } from '../utils/response.js';

export const updatesController = {
  async list(request: FastifyRequest<{ Querystring: UpdatesQuery }>, reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    if (request.query.after_release_id)
      request.query.after_release_id = request.query.after_release_id.toLowerCase();
    const data = await request.server.catalogService.updates(request.query);
    return envelope(request, data, data.history_complete ? [] : ['BASELINE_NOT_ANCESTOR']);
  }
};
