import { Router } from 'express';
import { updatesController } from '../controllers/updates.controller.js';

export const updatesRoutes = Router();

updatesRoutes.get('/', updatesController.list);
updatesRoutes.post('/', updatesController.create);
