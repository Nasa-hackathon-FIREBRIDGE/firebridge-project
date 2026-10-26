import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const reportsController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Report listing is not implemented yet.')),
  create: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Report creation is not implemented yet.'))
};
