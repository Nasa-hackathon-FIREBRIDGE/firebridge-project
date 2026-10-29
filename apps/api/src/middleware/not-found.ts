import type { FastifyReply, FastifyRequest } from 'fastify';
import { envelope } from '../utils/response.js';

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).send({
    ...envelope(request, null),
    status: 'error',
    code: 'NOT_FOUND',
    message: 'Resource not found.',
    error: { code: 'NOT_FOUND', message: 'Resource not found.' }
  });
}
