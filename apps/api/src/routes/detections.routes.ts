import { Router } from 'express';
import { detectionsController } from '../controllers/detections.controller.js';

export const detectionsRoutes = Router();

detectionsRoutes.get('/', detectionsController.list);
detectionsRoutes.post('/', detectionsController.create);
