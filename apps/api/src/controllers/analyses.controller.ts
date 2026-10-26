import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const analysesController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Analysis listing is not implemented yet.')),
  create: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Analysis creation is not implemented yet.'))
};
