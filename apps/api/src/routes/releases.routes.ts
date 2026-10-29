import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';
import { envelope } from '../utils/response.js';
import type { ReleaseQuery } from '../services/catalog.service.js';
import { uuidProperty, querySchema, successSchema } from './phase-one.schemas.js';

export const releasesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { release_id: string }; Querystring: ReleaseQuery }>(
    '/:release_id',
    {
      schema: {
        tags: ['Phase 1'],
        summary: 'Exact published release with signed membership pagination',
        params: querySchema({ release_id: uuidProperty }, ['release_id']),
        querystring: querySchema({
          membership: { type: 'string', enum: ['partitions', 'assets'] },
          limit: { type: 'string', pattern: '^(?:[1-9]|[1-9][0-9]|100)$', default: '50' },
          cursor: { type: 'string', minLength: 1, maxLength: 4096 }
        }),
        response: { 200: successSchema }
      }
    },
    async (request, reply) => {
      const data = await app.catalogService.release(
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
  );
};
