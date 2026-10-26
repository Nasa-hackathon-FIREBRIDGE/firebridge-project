import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const areasController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Area listing is not implemented yet.')),
  getById: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Area detail lookup is not implemented yet.'))
};
