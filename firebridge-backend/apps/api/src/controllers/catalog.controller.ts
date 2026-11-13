import type { FastifyReply, FastifyRequest } from 'fastify';
import { envelope } from '../utils/response.js';

export const catalogController = {
  async list(
    request: FastifyRequest<{ Querystring: { scope_key?: string } }>,
    reply: FastifyReply
  ) {
    reply.header('Cache-Control', 'no-store');
    const data = await request.server.catalogService.catalog(request.query.scope_key);
    return envelope(request, data);
  }
};
