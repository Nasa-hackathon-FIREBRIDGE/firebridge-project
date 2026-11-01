import type { CatalogService } from '../services/catalog.service.js';
import type { NativeResultsService } from '../services/native-results.service.js';
import type { IngestionService } from '../services/ingestion.service.js';
import type { Phase1ReadinessProvider, ReadinessProbes } from '../services/health.service.js';
declare module 'fastify' {
  interface FastifyInstance {
    catalogService: CatalogService;
    nativeResultsService: NativeResultsService;
    ingestionService: IngestionService;
    ingestionAdminToken: string | undefined;
    phase1ReadinessProvider: Phase1ReadinessProvider;
    readinessChecks: Partial<ReadinessProbes>;
  }
}
