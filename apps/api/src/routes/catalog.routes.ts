import { Router } from 'express';
import { catalogController } from '../controllers/catalog.controller.js';

export const catalogRoutes = Router();

catalogRoutes.get('/', catalogController.list);
catalogRoutes.get('/:id', catalogController.getById);
