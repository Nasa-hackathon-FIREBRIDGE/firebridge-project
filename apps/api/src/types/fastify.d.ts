import type { CatalogService } from '../services/catalog.service.js';
import type { Phase1ReadinessProvider, ReadinessProbes } from '../services/health.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    catalogService: CatalogService;
    phase1ReadinessProvider: Phase1ReadinessProvider;
    readinessChecks: Partial<ReadinessProbes>;
  }
}
