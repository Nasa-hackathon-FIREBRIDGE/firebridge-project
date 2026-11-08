import type { FastifyRequest, FastifyReply } from 'fastify';
import { sourcesService } from '../services/sources.service.js';
import { sourceCreateSchema, sourceListQuerySchema } from '../validators/sources.validator.js';
import { BadRequestError, ValidationError } from '../errors/app-error.js';
import { envelope } from '../utils/response.js';

export const sourcesController = {
  async list(request: FastifyRequest, reply: FastifyReply) {
    const parsed = sourceListQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new BadRequestError('Invalid source query.', 'INVALID_QUERY');
    const data = await sourcesService.list(parsed.data);
    return reply.send({ status: 'ok', message: 'Sources retrieved.', ...envelope(request, data) });
  },
  async create(request: FastifyRequest, reply: FastifyReply) {
    const parsed = sourceCreateSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid source payload.');
    const data = await sourcesService.create(parsed.data);
    return reply
      .status(201)
      .send({ status: 'ok', message: 'Source created.', ...envelope(request, data) });
  }
};
