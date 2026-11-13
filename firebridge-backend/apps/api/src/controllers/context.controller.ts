import type { FastifyRequest } from 'fastify';
import { defaultScopeResolver } from '../middleware/idempotency.js';
import { envelope } from '../utils/response.js';
import {
  coverageQuery,
  cellQuery,
  comparisonQuery,
  weatherQuery,
  reportsQuery,
  parseContext
} from '../validators/context.validator.js';

type ContextRequest = FastifyRequest<{ Params: { id: string } }>;

export const contextController = {
  async coverage(request: ContextRequest) {
    const data = await request.server.contextService.coverage(
      request.params.id.toLowerCase(),
      parseContext(coverageQuery, request.query)
    );
    return envelope(request, data);
  },

  async comparison(request: ContextRequest) {
    const data = await request.server.contextService.comparison(
      request.params.id.toLowerCase(),
      parseContext(comparisonQuery, request.query)
    );
    return envelope(request, data);
  },

  async weather(request: ContextRequest) {
    const data = await request.server.contextService.weather(
      request.params.id.toLowerCase(),
      parseContext(weatherQuery, request.query),
      defaultScopeResolver(request)
    );
    return envelope(request, data);
  },

  async reports(request: ContextRequest) {
    const data = await request.server.contextService.reports(
      request.params.id.toLowerCase(),
      parseContext(reportsQuery, request.query),
      defaultScopeResolver(request)
    );
    return envelope(request, data);
  },

  async cell(request: FastifyRequest<{ Params: { id: string; cell_id: string } }>) {
    const data = await request.server.contextService.cell(
      request.params.id.toLowerCase(),
      request.params.cell_id,
      parseContext(cellQuery, request.query),
      defaultScopeResolver(request)
    );
    return envelope(request, data);
  }
};
