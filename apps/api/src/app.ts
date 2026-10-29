import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { securityHeaders } from './middleware/security.js';
import apiRouter from './routes/index.js';

export function createApp() {
  const app = express();

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || (env.NODE_ENV !== 'production' && env.CORS_ORIGINS.length === 0)) {
          callback(null, true);
          return;
        }

        callback(null, env.CORS_ORIGINS.includes(origin));
      }
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(securityHeaders);

  const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
      title: 'FIREBRIDGE API',
      version: '1.0.0',
      description: 'OpenAPI specification for the FIREBRIDGE backend foundation.'
    },
    servers: [{ url: `http://localhost:${env.PORT}/api/v1` }]
  };

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerJsdoc({ definition: swaggerDefinition, apis: ['./src/routes/*.ts'] }))
  );

  // Canonical health endpoints are at /api/v1/health/live and /api/v1/health/ready.
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.logger = logger;
  return app;
}
