import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import formbody from '@fastify/formbody';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { securityHeaders } from './middleware/security.js';
import apiRoutes from './routes/index.js';
import { createDatabase, type SnapshotDatabase } from './repositories/database.js';
import { CatalogRepository } from './repositories/catalog.repository.js';
import { CatalogService } from './services/catalog.service.js';
import type { ReadinessProbes } from './services/health.service.js';
import { NativeResultsRepository } from './repositories/native-results.repository.js';
import { NativeResultsService } from './services/native-results.service.js';
import { envelope } from './utils/response.js';

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
  app.decorate(
    'nativeResultsService',
    new NativeResultsService(new NativeResultsRepository(database), env)
  );
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
  app.addHook('onRequest', securityHeaders);
  // Phase 2 handlers retain their status/message fields and gain the shared envelope.
  app.addHook('preSerialization', async (request, _reply, payload) => {
    if (payload && typeof payload === 'object' && 'data' in payload && !('request_id' in payload))
      return { ...payload, ...envelope(request, payload.data) };
    return payload;
  });
  app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: { action: 'deny' }
  });
  app.register(cors, {
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    exposedHeaders: ['ETag', 'X-Request-Id', 'X-Data-Release-Id', 'Idempotent-Replayed'],
    origin: (origin, callback) =>
      callback(
        null,
        !origin ||
          (env.NODE_ENV !== 'production' && env.CORS_ORIGINS.length === 0) ||
          env.CORS_ORIGINS.includes(origin)
      )
  });
  app.register(compress);
  app.register(formbody, { bodyLimit: 100 * 1024 });
  app.register(swagger, { openapi: { info: { title: 'FIREBRIDGE API', version: '1.0.0' } } });
  app.register(swaggerUi, { routePrefix: '/api-docs' });
  app.register(apiRoutes, { prefix: '/api/v1' });
  app.setNotFoundHandler(notFoundHandler);
  app.setErrorHandler(errorHandler);
  return app;
}
