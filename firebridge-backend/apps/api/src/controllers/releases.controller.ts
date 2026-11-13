import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ReleaseQuery } from '../services/catalog.service.js';
import { envelope } from '../utils/response.js';

export const releasesController = {
  async getById(
    request: FastifyRequest<{ Params: { release_id: string }; Querystring: ReleaseQuery }>,
    reply: FastifyReply
  ) {
    const data = await request.server.catalogService.release(
      request.params.release_id.toLowerCase(),
      request.query
    );
    const etag = '"' + createHash('sha256').update(JSON.stringify(data)).digest('hex') + '"';
    reply.header('ETag', etag).header('Cache-Control', 'private, max-age=0, must-revalidate');
    const matches = request.headers['if-none-match']?.split(',').map((value) => value.trim());
    if (matches?.includes(etag) || matches?.includes('W/' + etag) || matches?.includes('*'))
      return reply.status(304).send();
    return envelope(request, data);
  }
};
