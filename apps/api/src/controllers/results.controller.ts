import type { FastifyReply, FastifyRequest } from 'fastify';
import { limitResultRequest } from '../middleware/results-access.js';
import { tilesService } from '../services/tiles.service.js';
import { exportsService } from '../services/exports.service.js';
import { exportInputSchema, parseResultInput, resultIdSchema, tileParamsSchema } from '../validators/results.validator.js';
import { validateIdempotencyKeyFormat } from '../middleware/idempotency.js';

export const resultsController = {
  async tile(req: FastifyRequest, reply: FastifyReply) {
    const params = parseResultInput(tileParamsSchema, req.params);
    const tile = await tilesService.get(params, req.resultContext!, (state) => { reply.header('X-Tile-Cache', state); });
    return reply.header('Cache-Control', 'private, no-store')
      .type('application/vnd.mapbox-vector-tile').send(tile);
  },

  async createExport(req: FastifyRequest, reply: FastifyReply) {
    const { id } = parseResultInput(resultIdSchema, req.params);
    const input = parseResultInput(exportInputSchema, req.body);
    const key = validateIdempotencyKeyFormat(req.headers['idempotency-key']);
    const result = await exportsService.create(id, input, key);
    return reply.code(202).header('Location', result.status_url).send({
      status: 'ok', message: 'Export queued.', data: result
    });
  },

  async download(req: FastifyRequest, reply: FastifyReply) {
    reply.header('Cache-Control', 'private, no-store');
    const { id } = parseResultInput(resultIdSchema, req.params);
    await limitResultRequest(req, reply, 'download');
    const file = await exportsService.download(id);
    return reply.type(file.mime).header('Content-Disposition', `attachment; filename="${file.filename}"`)
      .header('Content-Length', String(file.bytes)).send(file.stream);
  }
};
