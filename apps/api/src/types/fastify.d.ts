import type { CatalogService } from '../services/catalog.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    catalogService: CatalogService;
  }
}
