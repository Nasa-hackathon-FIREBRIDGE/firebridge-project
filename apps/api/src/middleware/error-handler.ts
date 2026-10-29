import type { ErrorRequestHandler } from 'express';
import { logger } from '../config/logger.js';

function getStatusCode(error: unknown): number {
  if (typeof error !== 'object' || error === null) {
    return 500;
  }

  const candidate = 'statusCode' in error ? error.statusCode : 'status' in error ? error.status : undefined;
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599
    ? candidate
    : 500;
}

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = getStatusCode(error);
  const errorType = error instanceof Error ? error.name : 'UnknownError';
  logger.error({ statusCode: status, errorType, method: req.method, path: req.path }, 'Request failed');
  res.status(status).json({
    status: 'error',
    message: status >= 500 ? 'Internal server error.' : 'Request could not be processed.',
    data: null
  });
};
