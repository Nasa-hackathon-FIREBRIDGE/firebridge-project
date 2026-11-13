import type { FastifyReply, FastifyRequest } from 'fastify';
import { ingestionAdmin } from '../middleware/ingestion-admin.js';
import { envelope, ApiError } from '../utils/response.js';
import {
  parseInput,
  backfillSchema,
  refreshSchema,
  subscriptionsQuery,
  gapsQuery,
  availabilityQuery
} from '../validators/ingestion.validator.js';

function key(request: FastifyRequest) {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string')
    throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key is required.');
  return value;
}

function actor(request: FastifyRequest) {
  return ingestionAdmin(request, request.server.ingestionAdminToken);
}

export const ingestionController = {
  async subscriptions(request: FastifyRequest) {
    const data = await request.server.ingestionService.subscriptions(
      parseInput(subscriptionsQuery, request.query),
      actor(request)
    );
    return envelope(request, data);
  },

  async gaps(request: FastifyRequest) {
    const data = await request.server.ingestionService.gaps(
      parseInput(gapsQuery, request.query),
      actor(request)
    );
    return envelope(request, data);
  },

  async run(request: FastifyRequest<{ Params: { id: string } }>) {
    const data = await request.server.ingestionService.run(request.params.id.toLowerCase());
    return envelope(request, data);
  },

  async backfill(request: FastifyRequest, reply: FastifyReply) {
    const result = await request.server.ingestionService.backfill(
      parseInput(backfillSchema, request.body),
      actor(request),
      key(request)
    );
    if (result.statusCode === 200) reply.header('Idempotent-Replayed', 'true');
    return reply.code(result.statusCode).send(envelope(request, result.data));
  },

  async refresh(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const result = await request.server.ingestionService.refresh(
      request.params.id.toLowerCase(),
      parseInput(refreshSchema, request.body),
      actor(request),
      key(request)
    );
    if (result.statusCode === 200) reply.header('Idempotent-Replayed', 'true');
    return reply.code(result.statusCode).send(envelope(request, result.data));
  },

  async availability(request: FastifyRequest<{ Params: { source_id: string } }>) {
    const data = await request.server.ingestionService.availability(
      request.params.source_id,
      parseInput(availabilityQuery, request.query)
    );
    return envelope(request, data);
  }
};
