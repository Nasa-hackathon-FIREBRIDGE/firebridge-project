import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const sourcesController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Source listing is not implemented yet.')),
  create: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Source creation is not implemented yet.'))
};
