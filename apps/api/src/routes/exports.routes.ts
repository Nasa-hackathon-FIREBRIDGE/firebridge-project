import type { FastifyPluginAsync } from 'fastify';
import { exportsController } from '../controllers/exports.controller.js';

export const exportsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', exportsController.list);
  app.post('/', exportsController.create);
};
