import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const weatherController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Weather listing is not implemented yet.')),
  getByLocation: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Weather detail lookup is not implemented yet.'))
};
