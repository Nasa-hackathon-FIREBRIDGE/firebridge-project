import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const detectionsController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Detection listing is not implemented yet.')),
  create: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Detection creation is not implemented yet.'))
};
