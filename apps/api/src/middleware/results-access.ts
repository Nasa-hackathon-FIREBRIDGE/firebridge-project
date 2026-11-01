import { createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { findResultContext, resultAvailability, resultsConfig, type ResultContext } from '@firebridge/results';
import { redis, ensureRedisConnected } from '../config/redis.js';
import { ConflictError, NotFoundError, ServiceUnavailableError, TooManyRequestsError } from '../errors/app-error.js';
import { parseResultInput, resultIdSchema, tileParamsSchema } from '../validators/results.validator.js';

declare module 'fastify' {
  interface FastifyRequest {
    resultContext?: ResultContext;
  }
}

// Network throttling only: Fastify trustProxy stays disabled, so client-supplied
// forwarding or identity headers cannot change the scope.
export function resultRequestScope(req: FastifyRequest): string {
  return 'ip:' + createHash('sha256').update(req.ip).digest('hex');
}

export function assertResultAvailable(context: ResultContext): void {
  if (resultAvailability(context) === 'pending') throw new ConflictError('Analysis results are not available.');
  if (resultAvailability(context) === 'unsupported') throw new ConflictError('This analysis selection is not supported for Phase 4.');
}

export async function requireAvailableResult(analysisId: string): Promise<ResultContext> {
  const context = await findResultContext(analysisId);
  if (!context) throw new NotFoundError('Analysis was not found.');
  assertResultAvailable(context);
  return context;
}

const LIMIT_SCRIPT = "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end; return count";

export async function limitResultRequest(req: FastifyRequest, reply: FastifyReply, operation: 'tile' | 'export' | 'download'): Promise<void> {
  const maximum = operation === 'tile' ? resultsConfig.TILE_REQUESTS_PER_MINUTE
    : operation === 'export' ? resultsConfig.EXPORT_REQUESTS_PER_MINUTE : resultsConfig.DOWNLOAD_REQUESTS_PER_MINUTE;
  let count: unknown;
  try {
    await ensureRedisConnected();
    count = await redis.eval(LIMIT_SCRIPT, 1, 'phase4:rate:' + operation + ':' + resultRequestScope(req) + ':' + Math.floor(Date.now() / 60000));
  } catch {
    throw new ServiceUnavailableError('Request limiter is unavailable.');
  }
  if (Number(count) > maximum) {
    reply.header('Retry-After', '60');
    throw new TooManyRequestsError();
  }
}

export async function prepareTile(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.header('Cache-Control', 'private, no-store');
  const params = parseResultInput(tileParamsSchema, req.params);
  await limitResultRequest(req, reply, 'tile');
  req.resultContext = await requireAvailableResult(params.id);
}

export async function prepareExport(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.header('Cache-Control', 'private, no-store');
  const { id } = parseResultInput(resultIdSchema, req.params);
  await limitResultRequest(req, reply, 'export');
  req.resultContext = await requireAvailableResult(id);
}
