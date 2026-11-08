import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NativeQuery } from '../services/native-results.service.js';
import { defaultScopeResolver } from '../middleware/idempotency.js';
import { envelope } from '../utils/response.js';

type NativeRequest = FastifyRequest<{ Params: { id: string }; Querystring: NativeQuery }>;

function sendNativeResult<T extends { data_release_id: string }>(
  request: FastifyRequest,
  reply: FastifyReply,
  data: T
) {
  const digest = '"' + createHash('sha256').update(JSON.stringify(data)).digest('hex') + '"';
  // Request IDs vary; cache validation applies only to the logical result.
  reply
    .header('ETag', 'W/' + digest)
    .header('Cache-Control', 'private, max-age=0, must-revalidate')
    .header('X-Data-Release-Id', data.data_release_id);
  const matches = request.headers['if-none-match']?.split(',').map((value) => value.trim());
  if (matches?.some((value) => value.replace(/^W\//, '') === digest || value === '*'))
    return reply.code(304).send();
  return envelope(request, data);
}

export const nativeResultsController = {
  async detections(request: NativeRequest, reply: FastifyReply) {
    const data = await request.server.nativeResultsService.detections(
      request.params.id.toLowerCase(),
      request.query,
      defaultScopeResolver(request)
    );
    return sendNativeResult(request, reply, data);
  },

  async summary(request: NativeRequest, reply: FastifyReply) {
    const data = await request.server.nativeResultsService.summary(request.params.id.toLowerCase());
    return sendNativeResult(request, reply, data);
  },

  async calendar(request: NativeRequest, reply: FastifyReply) {
    const data = await request.server.nativeResultsService.calendar(
      request.params.id.toLowerCase(),
      request.query
    );
    return sendNativeResult(request, reply, data);
  },

  async provenance(request: NativeRequest, reply: FastifyReply) {
    const data = await request.server.nativeResultsService.provenance(
      request.params.id.toLowerCase(),
      request.query,
      defaultScopeResolver(request)
    );
    return sendNativeResult(request, reply, data);
  }
};
