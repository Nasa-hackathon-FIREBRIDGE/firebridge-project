import { Router } from 'express';
import { cellsController } from '../controllers/cells.controller.js';

export const cellsRoutes = Router();

cellsRoutes.get('/', cellsController.list);
cellsRoutes.get('/:cellId', cellsController.getById);
