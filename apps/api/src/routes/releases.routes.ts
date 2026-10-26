import { Router } from 'express';
import { releasesController } from '../controllers/releases.controller.js';

export const releasesRoutes = Router();

releasesRoutes.get('/', releasesController.list);
releasesRoutes.get('/:id', releasesController.getById);
