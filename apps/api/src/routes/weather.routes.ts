import type { FastifyPluginAsync } from 'fastify';
import { weatherController } from '../controllers/weather.controller.js';

export const weatherRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', weatherController.list);
  app.get('/:locationId', weatherController.getByLocation);
};
