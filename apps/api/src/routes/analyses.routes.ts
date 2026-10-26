import { Router } from 'express';
import { analysesController } from '../controllers/analyses.controller.js';

export const analysesRoutes = Router();

analysesRoutes.get('/', analysesController.list);
analysesRoutes.post('/', analysesController.create);
