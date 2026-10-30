import type { FastifyPluginAsync } from 'fastify';
import { weatherController } from '../controllers/weather.controller.js';

export const weatherRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', weatherController.list);
  fastify.get('/:locationId', weatherController.getByLocation);
};
