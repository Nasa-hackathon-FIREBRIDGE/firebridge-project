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

export function createApp(options: { database?: SnapshotDatabase; logger?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger ?? { level: env.LOG_LEVEL },
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } }
  });
  const database = options.database ?? createDatabase(env.DATABASE_URL);
  app.decorate('catalogService', new CatalogService(new CatalogRepository(database), env));
  app.addHook('onClose', async () => {
    if (!options.database) await database.close();
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });
  app.register(helmet);
  app.register(cors);
  app.register(compress);
  app.register(swagger, { openapi: { info: { title: 'FIREBRIDGE API', version: '1.0.0' } } });
  app.register(swaggerUi, { routePrefix: '/api-docs' });
  app.get('/health', async () => ({ status: 'ok', service: env.APP_NAME }));
  app.register(apiRoutes, { prefix: '/api/v1' });
  app.setNotFoundHandler(notFoundHandler);
  app.setErrorHandler(errorHandler);
  return app;
}
