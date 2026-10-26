import { Router } from 'express';
import { exportsController } from '../controllers/exports.controller.js';

export const exportsRoutes = Router();

exportsRoutes.get('/', exportsController.list);
exportsRoutes.post('/', exportsController.create);
