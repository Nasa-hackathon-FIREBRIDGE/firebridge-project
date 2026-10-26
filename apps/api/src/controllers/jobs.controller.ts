import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const jobsController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Job listing is not implemented yet.')),
  getById: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Job detail lookup is not implemented yet.'))
};
