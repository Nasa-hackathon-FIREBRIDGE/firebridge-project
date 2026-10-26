import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const cellsController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Cell listing is not implemented yet.')),
  getById: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Cell detail lookup is not implemented yet.'))
};
