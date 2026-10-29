import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, envelope } from '../utils/response.js';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const status =
    error instanceof ApiError
      ? error.statusCode
      : error.validation
        ? 422
        : error.statusCode && error.statusCode < 500
          ? error.statusCode
          : 500;
  const code =
    error instanceof ApiError
      ? error.code
      : error.validation
        ? 'INVALID_REQUEST'
        : status < 500
          ? 'BAD_REQUEST'
          : 'INTERNAL_ERROR';
  const message =
    error instanceof ApiError
      ? error.message
      : error.validation
        ? 'Invalid request parameters.'
        : status < 500
          ? 'Malformed request.'
          : 'Internal server error.';
  if (status >= 500) request.log.error({ code, request_id: request.id }, 'Request failed');
  return reply.status(status).send({ ...envelope(request, null), error: { code, message } });
}
