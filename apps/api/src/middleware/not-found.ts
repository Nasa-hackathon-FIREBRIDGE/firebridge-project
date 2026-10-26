import type { Request, Response } from 'express';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    status: 'error',
    message: 'Resource not found.',
    data: null
  });
}
