import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const adminController = {
  status: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Administrative status is not implemented yet.')),
  refresh: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Administrative refresh action is not implemented yet.'))
};
