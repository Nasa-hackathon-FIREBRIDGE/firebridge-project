import type { FastifyPluginAsync } from 'fastify';
import { envelope } from '../utils/response.js';
import { scopeProperty, querySchema, successSchema } from './phase-one.schemas.js';

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { scope_key?: string } }>(
    '/',
    {
      schema: {
        tags: ['Phase 1'],
        summary: 'Published catalog for a registered scope',
        querystring: querySchema({ scope_key: scopeProperty }),
        response: { 200: successSchema }
      }
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return envelope(request, await app.catalogService.catalog(request.query.scope_key));
    }
  );
};
