import type { FastifyReply, FastifyRequest } from 'fastify';
import { defaultScopeResolver } from '../middleware/idempotency.js';
import { envelope } from '../utils/response.js';
import { explanationBody, parseContext } from '../validators/context.validator.js';

type ExplanationRequest = FastifyRequest<{ Params: { id: string } }>;

export const explanationController = {
  async create(request: ExplanationRequest, reply: FastifyReply) {
    const result = await request.server.explanationService.create(
      request.params.id.toLowerCase(),
      parseContext(explanationBody, request.body),
      defaultScopeResolver(request),
      request.headers['idempotency-key'] as string | undefined
    );
    return reply.code(result.statusCode).send(envelope(request, result.data));
  },

  async getById(request: ExplanationRequest) {
    const data = await request.server.explanationService.get(
      request.params.id.toLowerCase(),
      defaultScopeResolver(request)
    );
    return envelope(request, data);
  }
};
