import type { FastifyReply, FastifyRequest } from 'fastify';
import { sourcesService } from '../services/sources.service.js';
import { sourceCreateSchema, sourceListQuerySchema } from '../validators/sources.validator.js';
import { ErrorCodes } from '../types/api.js';

export const sourcesController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    const parsedQuery = sourceListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        status: 'error',
        code: ErrorCodes.INVALID_QUERY,
        message: 'Invalid source query.',
        data: null
      });
    }

    const data = await sourcesService.list(parsedQuery.data);
    return reply.code(200).send({ status: 'ok', message: 'Sources retrieved.', data });
  },

  async create(req: FastifyRequest, reply: FastifyReply) {
    const parsedBody = sourceCreateSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        status: 'error',
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Invalid source payload.',
        data: null
      });
    }

    const source = await sourcesService.create(parsedBody.data);
    return reply.code(201).send({ status: 'ok', message: 'Source created.', data: source });
  }
};
