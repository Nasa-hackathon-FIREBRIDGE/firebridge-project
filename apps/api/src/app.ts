import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import apiRoutes from './routes/index.js';
import { createDatabase, type SnapshotDatabase } from './repositories/database.js';
import { CatalogRepository } from './repositories/catalog.repository.js';
import { CatalogService } from './services/catalog.service.js';
import type { ReadinessProbes } from './services/health.service.js';

export function createApp(
  options: {
    database?: SnapshotDatabase;
    logger?: boolean;
    readinessChecks?: Partial<ReadinessProbes>;
  } = {}
) {
  const app = Fastify({
    logger: options.logger ?? { level: env.LOG_LEVEL },
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } }
  });
  const database = options.database ?? createDatabase(env.DATABASE_URL);
  const catalogService = new CatalogService(new CatalogRepository(database), env);
  app.decorate('catalogService', catalogService);
  app.decorate('readinessChecks', options.readinessChecks ?? {});
  app.decorate('phase1ReadinessProvider', {
    async isCatalogueServable() {
      try {
        await catalogService.catalog();
        return true;
      } catch {
        return false;
      }
    }
  });
  app.addHook('onClose', async () => {
    if (!options.database) await database.close();
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });
  app.register(helmet);
  app.register(cors, {
    origin: (origin, callback) =>
      callback(
        null,
        !origin ||
          (env.NODE_ENV !== 'production' && env.CORS_ORIGINS.length === 0) ||
          env.CORS_ORIGINS.includes(origin)
      )
  });
  app.register(compress);
  app.register(swagger, { openapi: { info: { title: 'FIREBRIDGE API', version: '1.0.0' } } });
  app.register(swaggerUi, { routePrefix: '/api-docs' });
  app.register(apiRoutes, { prefix: '/api/v1' });
  app.setNotFoundHandler(notFoundHandler);
  app.setErrorHandler(errorHandler);
  return app;
}
