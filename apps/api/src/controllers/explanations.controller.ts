import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const explanationsController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Explanation listing is not implemented yet.')),
  create: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Explanation creation is not implemented yet.'))
};
