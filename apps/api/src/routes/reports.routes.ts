import { Router } from 'express';
import { reportsController } from '../controllers/reports.controller.js';

export const reportsRoutes = Router();

reportsRoutes.get('/', reportsController.list);
reportsRoutes.post('/', reportsController.create);
