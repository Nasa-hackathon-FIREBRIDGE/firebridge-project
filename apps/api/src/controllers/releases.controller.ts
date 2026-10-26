import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const releasesController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Release listing is not implemented yet.')),
  getById: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Release detail lookup is not implemented yet.'))
};
