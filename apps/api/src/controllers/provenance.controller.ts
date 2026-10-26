import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const provenanceController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Provenance listing is not implemented yet.')),
  getById: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Provenance detail lookup is not implemented yet.'))
};
