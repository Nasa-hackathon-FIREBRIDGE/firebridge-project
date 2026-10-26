import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const exportsController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Export listing is not implemented yet.')),
  create: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Export creation is not implemented yet.'))
};
