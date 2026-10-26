import { Router } from 'express';
import { adminController } from '../controllers/admin.controller.js';

export const adminRoutes = Router();

adminRoutes.get('/status', adminController.status);
adminRoutes.post('/refresh', adminController.refresh);
