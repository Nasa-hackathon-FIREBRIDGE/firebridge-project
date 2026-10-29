import { Router } from 'express';
import { sourcesController } from '../controllers/sources.controller.js';
import { idempotency } from '../middleware/idempotency.js';

export const sourcesRoutes = Router();

sourcesRoutes.get('/', sourcesController.list);
sourcesRoutes.post('/', idempotency({ required: false }), sourcesController.create);
