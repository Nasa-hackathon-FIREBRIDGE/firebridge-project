import type { FastifyReply, FastifyRequest } from 'fastify';
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

export interface ErrorResponse {
  status: number;
  body: { status: 'error'; code: string; message: string; data: null };
}

/**
 * Framework-agnostic: logs (sanitized) and builds the public error envelope.
 * Shared by the Fastify error handler and the legacy Express bridge in app.ts.
 */
export function resolveErrorResponse(error: unknown, method: string, path: string): ErrorResponse {
  const status = getStatusCode(error);
  const code = getErrorCode(error, status);
  const errorType = error instanceof Error ? error.name : 'UnknownError';

  logger.error({ statusCode: status, errorCode: code, errorType, method, path }, 'Request failed');

  const message =
    error instanceof AppError && status < 500
      ? error.message
      : status >= 500
        ? 'Internal server error.'
        : 'Request could not be processed.';

  return { status, body: { status: 'error', code, message, data: null } };
}

/**
 * Use with: app.setErrorHandler(errorHandler)
 */
export function errorHandler(error: unknown, req: FastifyRequest, reply: FastifyReply): void {
  // Query string excluded from logs, as Express's req.path did.
  const { status, body } = resolveErrorResponse(error, req.method, req.url.split('?')[0] ?? '');

  // Express delegated to the default handler here, which destroys the socket.
  if (reply.raw.headersSent) {
    req.raw.socket.destroy();
    return;
  }

  void reply.code(status).send(body);
}