import fastifyCompress from '@fastify/compress';
import fastifyCors from '@fastify/cors';
import fastifyFormbody from '@fastify/formbody';
import fastifyHelmet from '@fastify/helmet';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { securityHeaders } from './middleware/security.js';
import { apiRoutes } from './routes/index.js';

const JSON_BODY_LIMIT_BYTES = 1024 * 1024; // 1MB
const URLENCODED_BODY_LIMIT_BYTES = 100 * 1024; // 100KB
const SWAGGER_UI_PREFIX = '/api-docs';

export interface CreateAppOptions {
  /** Kept for interface compatibility with existing test runners; Express is fully removed. */
  legacyExpress?: boolean;
}

export async function createApp(_options: CreateAppOptions = {}) {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: true,
    bodyLimit: JSON_BODY_LIMIT_BYTES
  });

  // --- Global Fastify hooks & handlers: set on the ROOT instance -----------------------------
  app.addHook('onRequest', securityHeaders);
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ method: request.method, route: request.routeOptions.url ?? 'unmatched',
      statusCode: reply.statusCode, durationMs: reply.elapsedTime, requestId: request.id }, 'HTTP request completed');
  });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // --- Security & content encoding plugins ----------------------------------------------------
  await app.register(fastifyHelmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(fastifyCors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, env.CORS_ORIGINS.includes(origin));
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']
  });
  await app.register(fastifyCompress);
  await app.register(fastifyFormbody, { bodyLimit: URLENCODED_BODY_LIMIT_BYTES });

  // --- Swagger documentation ------------------------------------------------------------------
  const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
      title: 'FIREBRIDGE API',
      version: '1.0.0',
      description: 'OpenAPI specification for the FIREBRIDGE backend foundation.'
    },
    servers: [{ url: '/' }]
  };
  await app.register(fastifySwagger, {
    openapi: swaggerDefinition
  });
  await app.register(fastifySwaggerUi, { routePrefix: SWAGGER_UI_PREFIX });

  // --- Native Fastify API routes (/api/v1) ---------------------------------------------------
  await app.register(apiRoutes, { prefix: '/api/v1' });

  return app;
}
