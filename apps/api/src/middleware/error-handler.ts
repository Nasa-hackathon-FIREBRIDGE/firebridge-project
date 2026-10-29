import type { ErrorRequestHandler } from 'express';
import { logger } from '../config/logger.js';
import { AppError } from '../errors/app-error.js';
import { ErrorCodes } from '../types/api.js';

function getStatusCode(error: unknown): number {
  if (typeof error !== 'object' || error === null) {
    return 500;
  }

  const candidate = 'statusCode' in error ? error.statusCode : 'status' in error ? error.status : undefined;
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599
    ? candidate
    : 500;
}

function getErrorCode(error: unknown, status: number): string {
  if (error instanceof AppError && error.code) {
    return error.code;
  }

  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  switch (status) {
    case 400:
      return ErrorCodes.BAD_REQUEST;
    case 404:
      return ErrorCodes.NOT_FOUND;
    case 409:
      return ErrorCodes.CONFLICT;
    case 429:
      return ErrorCodes.TOO_MANY_REQUESTS;
    case 503:
      return ErrorCodes.SERVICE_UNAVAILABLE;
    default:
      return ErrorCodes.INTERNAL_SERVER_ERROR;
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = getStatusCode(error);
  const code = getErrorCode(error, status);
  const errorType = error instanceof Error ? error.name : 'UnknownError';

  logger.error(
    {
      statusCode: status,
      errorCode: code,
      errorType,
      method: req.method,
      path: req.path
    },
    'Request failed'
  );

  const message =
    error instanceof AppError && status < 500
      ? error.message
      : status >= 500
        ? 'Internal server error.'
        : 'Request could not be processed.';

  res.status(status).json({
    status: 'error',
    code,
    message,
    data: null
  });
};
