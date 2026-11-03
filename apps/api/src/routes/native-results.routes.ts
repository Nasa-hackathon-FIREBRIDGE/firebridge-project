import type { FastifyPluginAsync } from 'fastify';
import type { NativeQuery } from '../services/native-results.service.js';
import { querySchema, successSchema, uuidProperty } from './phase-one.schemas.js';
import { nativeResultsController } from '../controllers/native-results.controller.js';

const time = { type: 'string', minLength: 20, maxLength: 24 };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const page = {
  limit: { type: 'string', pattern: '^[1-9][0-9]{0,3}$' },
  cursor: { type: 'string', minLength: 1, maxLength: 4096 }
};
const detectionQuery = querySchema({
  ...page,
  start: time,
  end_exclusive: time,
  source_ids: {
    type: 'string',
    minLength: 1,
    maxLength: 13000,
    pattern: '^[A-Za-z0-9_.:-]+(?:,[A-Za-z0-9_.:-]+)*$'
  },
  bbox: {
    type: 'string',
    maxLength: 128,
    pattern: '^-?[0-9]+(?:\\.[0-9]+)?(?:,-?[0-9]+(?:\\.[0-9]+)?){3}$'
  }
});
const calendarQuery = querySchema({
  resolution: { type: 'string', enum: ['day', 'week', 'month'] },
  start_date: date,
  end_date_exclusive: date
});
const provenanceQuery = querySchema({ ...page, asset_id: uuidProperty });

export const nativeResultsRoutes: FastifyPluginAsync = async (app) => {
  for (const [resource, summary, query, handler] of [
    [
      'detections',
      'Native detections clipped to the saved area and pinned release',
      detectionQuery,
      nativeResultsController.detections
    ],
    [
      'summary',
      'Source detection counts with explicit unavailable comparable metrics',
      querySchema({}),
      nativeResultsController.summary
    ],
    [
      'calendar',
      'UTC native counts; zero only for verified complete inventory',
      calendarQuery,
      nativeResultsController.calendar
    ],
    [
      'provenance',
      'Paginated pinned inputs, hashes and citations without private paths',
      provenanceQuery,
      nativeResultsController.provenance
    ]
  ] as const) {
    app.get<{ Params: { id: string }; Querystring: NativeQuery }>(
      `/:id/${resource}`,
      {
        schema: {
          tags: ['Phase 3'],
          summary,
          params: querySchema({ id: uuidProperty }, ['id']),
          querystring: query,
          response: { 200: successSchema }
        }
      },
      handler
    );
  }
};
