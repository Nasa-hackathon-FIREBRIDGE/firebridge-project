import type { Request, Response } from 'express';
import { healthService } from '../services/health.service.js';

export const healthController = {
  getLiveStatus: (_req: Request, res: Response) => {
    const result = healthService.getLiveStatus();
    res.status(200).json(result);
  },

  getReadiness: (_req: Request, res: Response) => {
    const result = healthService.getReadiness();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  }
};
