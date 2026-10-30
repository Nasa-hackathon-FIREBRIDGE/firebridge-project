/**
 * Areas controller — Fastify-native handlers
 *
 * POST /api/v1/areas       — Endpoint 6 (Create or reuse area)
 * GET  /api/v1/areas/:area_id — Endpoint 7 (Retrieve area & spatial coverage)
 * GET  /api/v1/areas       — Scaffolded list endpoint
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { areasService } from '../services/areas.service.js';
import { ErrorCodes } from '../types/api.js';
import { areaCreateSchema, areaListQuerySchema } from '../validators/areas.validator.js';

export const areasController = {
  /**
   * GET /api/v1/areas — List areas with cursor pagination
   */
  async list(req: FastifyRequest, reply: FastifyReply) {
    const parsed = areaListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        status: 'error',
        code: ErrorCodes.INVALID_QUERY,
        message: 'Invalid area query parameters.',
        data: null
      });
    }

    const result = await areasService.list(parsed.data);

    return reply.code(200).send({
      status: 'ok',
      message: 'Areas retrieved.',
      data: {
        areas: result.areas.map((area) => ({
          id: area.id,
          name: area.name,
          version: area.version,
          geometry_sha256: area.geometry_sha256,
          display_timezone: area.display_timezone,
          provenance: area.provenance,
          created_at: area.created_at,
          geometry: JSON.parse(area.geom_geojson) as unknown,
          ...(area.surface_km2 !== undefined ? { surface_km2: area.surface_km2 } : {})
        })),
        nextCursor: result.nextCursor
      }
    });
  },

  /**
   * POST /api/v1/areas — Endpoint 6
   */
  async create(req: FastifyRequest, reply: FastifyReply) {
    const parsed = areaCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        status: 'error',
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Invalid area payload.',
        data: null
      });
    }

    const { area, created } = await areasService.createArea(parsed.data);

    const statusCode = created ? 201 : 200;
    const message = created ? 'Area created.' : 'Equivalent area already exists.';

    return reply.code(statusCode).send({
      status: 'ok',
      message,
      data: {
        id: area.id,
        name: area.name,
        version: area.version,
        geometry_sha256: area.geometry_sha256,
        display_timezone: area.display_timezone,
        provenance: area.provenance,
        created_at: area.created_at,
        geometry: JSON.parse(area.geom_geojson) as unknown,
        ...(area.surface_km2 !== undefined ? { surface_km2: area.surface_km2 } : {})
      }
    });
  },

  /**
   * GET /api/v1/areas/:area_id — Endpoint 7
   */
  async getById(req: FastifyRequest, reply: FastifyReply) {
    const params = req.params as Record<string, string | undefined>;
    const areaId = params.area_id ?? params.areaId;

    if (!areaId) {
      return reply.code(400).send({
        status: 'error',
        code: ErrorCodes.BAD_REQUEST,
        message: 'Area ID parameter is required.',
        data: null
      });
    }

    const area = await areasService.getAreaById(areaId);

    return reply.code(200).send({
      status: 'ok',
      message: 'Area retrieved.',
      data: {
        id: area.id,
        name: area.name,
        version: area.version,
        geometry_sha256: area.geometry_sha256,
        display_timezone: area.display_timezone,
        provenance: area.provenance,
        created_at: area.created_at,
        surface_km2: area.surface_km2,
        geometry: JSON.parse(area.geom_geojson) as unknown,
        coverage: {
          weights_status: area.weights_status,
          cells_count: area.cells_count,
          total_overlap_land_area_m2: area.total_overlap_land_area_m2,
          grid: area.grid
        }
      }
    });
  }
};
