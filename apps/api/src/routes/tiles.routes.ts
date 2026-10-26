import { Router } from 'express';
import { tilesController } from '../controllers/tiles.controller.js';

export const tilesRoutes = Router();

tilesRoutes.get('/', tilesController.list);
tilesRoutes.get('/:tileId', tilesController.getById);
