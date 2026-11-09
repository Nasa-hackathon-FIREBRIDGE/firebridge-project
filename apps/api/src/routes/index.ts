import type { FastifyPluginAsync } from 'fastify';
import { healthRoutes } from './health.routes.js';
import { catalogRoutes } from './catalog.routes.js';
import { sourcesRoutes } from './sources.routes.js';
import { releasesRoutes } from './releases.routes.js';
import { updatesRoutes } from './updates.routes.js';
import { areasRoutes } from './areas.routes.js';
import { analysesRoutes } from './analyses.routes.js';
import { nativeResultsRoutes } from './native-results.routes.js';
import { jobsRoutes } from './jobs.routes.js';
import { ingestionRoutes } from './ingestion.routes.js';
import { contextRoutes } from './context.routes.js';

const apiRoutes: FastifyPluginAsync = async (app) => {
  app.register(healthRoutes, { prefix: '/health' });
  app.register(catalogRoutes, { prefix: '/catalog' });
  app.register(sourcesRoutes, { prefix: '/sources' });
  app.register(releasesRoutes, { prefix: '/releases' });
  app.register(updatesRoutes, { prefix: '/updates' });
  app.register(areasRoutes, { prefix: '/areas' });
  app.register(analysesRoutes, { prefix: '/analyses' });
  app.register(nativeResultsRoutes, { prefix: '/analyses' });
  app.register(jobsRoutes, { prefix: '/jobs' });
  app.register(ingestionRoutes);
  app.register(contextRoutes);
};

export default apiRoutes;
