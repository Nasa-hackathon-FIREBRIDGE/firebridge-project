import type { Request, Response } from 'express';
import { ErrorCodes } from '../types/api.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    status: 'error',
    code: ErrorCodes.NOT_FOUND,
    message: 'Resource not found.',
    data: null
  });
}
