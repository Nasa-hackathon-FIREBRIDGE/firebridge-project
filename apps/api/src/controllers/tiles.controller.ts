import type { Request, Response } from 'express';
import { plannedResponse } from '../utils/planned-response.js';

export const tilesController = {
  list: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Tile listing is not implemented yet.')),
  getById: (_req: Request, res: Response) => res.status(501).json(plannedResponse('Tile detail lookup is not implemented yet.'))
};
