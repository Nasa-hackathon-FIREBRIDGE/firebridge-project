import { Router } from 'express';
import { jobsController } from '../controllers/jobs.controller.js';

export const jobsRoutes = Router();

jobsRoutes.get('/', jobsController.list);
jobsRoutes.get('/:jobId', jobsController.getById);
