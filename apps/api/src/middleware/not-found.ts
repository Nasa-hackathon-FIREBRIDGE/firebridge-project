import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCodes } from '../types/api.js';

/** Shared 404 envelope (Fastify handler below + the legacy Express layer in app.ts). */
export const NOT_FOUND_BODY = {
  status: 'error',
  code: ErrorCodes.NOT_FOUND,
  message: 'Resource not found.',
  data: null
} as const;

/**
 * Use with: app.setNotFoundHandler(notFoundHandler)
 */
export function notFoundHandler(_req: FastifyRequest, reply: FastifyReply): void {
  void reply.code(404).send(NOT_FOUND_BODY);
}