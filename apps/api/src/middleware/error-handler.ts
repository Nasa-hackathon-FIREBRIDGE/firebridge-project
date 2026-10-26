import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = typeof error.statusCode === 'number' ? error.statusCode : 500;

  res.status(status).json({
    status: 'error',
    message: error.message || 'Internal server error',
    data: null
  });
};
