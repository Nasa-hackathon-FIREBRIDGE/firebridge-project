import { Router } from 'express';
import { provenanceController } from '../controllers/provenance.controller.js';

export const provenanceRoutes = Router();

provenanceRoutes.get('/', provenanceController.list);
provenanceRoutes.get('/:id', provenanceController.getById);
