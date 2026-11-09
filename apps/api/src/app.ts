import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
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
import { IngestionRepository } from './repositories/ingestion.repository.js';
import { IngestionService } from './services/ingestion.service.js';
import { ContextRepository } from './repositories/context.repository.js';
import { ContextService } from './services/context.service.js';
import { ExplanationService } from './services/explanation.service.js';

export function createApp(
  options: {
    database?: SnapshotDatabase;
    logger?: boolean;
    readinessChecks?: Partial<ReadinessProbes>;
    ingestionAdminToken?: string;
  } = {}
): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? { level: env.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: env.NODE_ENV === 'production' ? (_address: string, hop: number) => hop === 0 : false,
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } }
  });
  const database = options.database ?? createDatabase(env.DATABASE_URL);
  const catalogService = new CatalogService(new CatalogRepository(database), env);
  app.decorate('catalogService', catalogService);
  app.decorate('ingestionService', new IngestionService(new IngestionRepository(database), env));
  app.decorate('ingestionAdminToken', options.ingestionAdminToken ?? env.INGESTION_ADMIN_TOKEN);
  app.decorate(
    'nativeResultsService',
    new NativeResultsService(new NativeResultsRepository(database), env)
  );
  app.decorate('readinessChecks', options.readinessChecks ?? {});
  const contextService = new ContextService(
    new ContextRepository(database),
    app.nativeResultsService,
    env
  );
  app.decorate('contextService', contextService);
  app.decorate('explanationService', new ExplanationService(contextService));
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
    exposedHeaders: ['ETag', 'X-Request-Id', 'X-Data-Release-Id', 'Idempotent-Replayed', 'Content-Disposition', 'Retry-After', 'Location'],
    origin: (origin, callback) =>
      callback(
        null,
        !origin ||
          env.CORS_ORIGINS.includes(origin)
      )
  });
  if (env.NODE_ENV === 'production') {
    app.register(rateLimit, { max: 120, timeWindow: '1 minute', allowList: (request) => request.url.startsWith('/api/v1/health/') });
  }
  app.register(compress);
  app.register(formbody, { bodyLimit: 100 * 1024 });
  app.register(swagger, {
    openapi: {
      info: { title: 'FIREBRIDGE API', version: '1.0.0' },
      components: { securitySchemes: { ingestionAdmin: { type: 'http', scheme: 'bearer' } } }
    }
  });
  app.register(swaggerUi, { routePrefix: '/api-docs' });
  app.register(apiRoutes, { prefix: '/api/v1' });
  app.setNotFoundHandler(notFoundHandler);
  app.setErrorHandler(errorHandler);
  return app;
}
