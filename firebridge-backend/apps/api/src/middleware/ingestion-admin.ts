import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../utils/response.js';

/** Dedicated operational token; fail closed even in local development. */
export function ingestionAdmin(request: FastifyRequest, token: string | undefined): string {
  if (!token)
    throw new ApiError(503, 'ADMIN_NOT_CONFIGURED', 'Ingestion administration is not configured.');
  const provided = request.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1] ?? '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(provided), digest(token)))
    throw new ApiError(401, 'UNAUTHORIZED', 'Valid administrator credentials are required.');
  // Do not persist or expose the bearer token itself.
  return 'ingestion-admin:' + digest(token).toString('hex').slice(0, 32);
}
