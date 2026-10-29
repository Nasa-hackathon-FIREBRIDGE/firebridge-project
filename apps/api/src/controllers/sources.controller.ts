import type { NextFunction, Request, Response } from 'express';
import { sourcesService } from '../services/sources.service.js';
import { sourceCreateSchema, sourceListQuerySchema } from '../validators/sources.validator.js';
import { ErrorCodes } from '../types/api.js';

export const sourcesController = {
  async list(req: Request, res: Response, next: NextFunction) {
    const parsedQuery = sourceListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({
        status: 'error',
        code: ErrorCodes.INVALID_QUERY,
        message: 'Invalid source query.',
        data: null
      });
      return;
    }

    try {
      const data = await sourcesService.list(parsedQuery.data);
      res.status(200).json({ status: 'ok', message: 'Sources retrieved.', data });
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    const parsedBody = sourceCreateSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        status: 'error',
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Invalid source payload.',
        data: null
      });
      return;
    }

    try {
      const source = await sourcesService.create(parsedBody.data);
      res.status(201).json({ status: 'ok', message: 'Source created.', data: source });
    } catch (error) {
      next(error);
    }
  }
};
