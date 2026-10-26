import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const catalogController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Catalog listing is not implemented yet.')),
  getById: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Catalog detail lookup is not implemented yet.'))
};
