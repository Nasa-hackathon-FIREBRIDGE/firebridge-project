import { Router } from 'express';
import { areasController } from '../controllers/areas.controller.js';

export const areasRoutes = Router();

areasRoutes.get('/', areasController.list);
areasRoutes.get('/:areaId', areasController.getById);
