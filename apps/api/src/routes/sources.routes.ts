import { Router } from 'express';
import { sourcesController } from '../controllers/sources.controller.js';

export const sourcesRoutes = Router();

sourcesRoutes.get('/', sourcesController.list);
sourcesRoutes.post('/', sourcesController.create);
