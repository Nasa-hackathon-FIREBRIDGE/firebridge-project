import type { Request, Response, NextFunction } from 'express';
import { healthService } from '../services/health.service.js';

export const healthController = {
  getLiveStatus: (_req: Request, res: Response) => {
    res.status(200).json(healthService.getLiveStatus());
  },

  async getReadiness(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await healthService.getReadiness();
      res.status(result.status === 'ok' ? 200 : 503).json(result);
    } catch (error) {
      next(error);
    }
  }
};
