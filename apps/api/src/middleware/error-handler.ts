import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import { ApiError, envelope } from '../utils/response.js';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const operational = error instanceof AppError || error instanceof ApiError;
  const candidate = operational ? error.statusCode : error.validation ? 422 : error.statusCode;
  const status =
    typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 400 &&
    candidate <= 599
      ? candidate
      : 500;
  const code = operational
    ? error.code
    : error.validation
      ? 'INVALID_REQUEST'
      : status >= 500
        ? 'INTERNAL_SERVER_ERROR'
        : 'BAD_REQUEST';
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof AppError && status < 500
        ? error.message
        : error.validation
          ? 'Invalid request parameters.'
          : status >= 500
            ? 'Internal server error.'
            : 'Malformed request.';
  if (status >= 500) request.log.error({ code, request_id: request.id }, 'Request failed');
  return reply.status(status).send({
    ...envelope(request, null),
    status: 'error',
    code,
    message,
    error: { code, message }
  });
}
