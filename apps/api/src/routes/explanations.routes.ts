import { Router } from 'express';
import { explanationsController } from '../controllers/explanations.controller.js';

export const explanationsRoutes = Router();

explanationsRoutes.get('/', explanationsController.list);
explanationsRoutes.post('/', explanationsController.create);
