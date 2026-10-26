import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const updatesController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Update listing is not implemented yet.')),
  create: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Update creation is not implemented yet.'))
};
