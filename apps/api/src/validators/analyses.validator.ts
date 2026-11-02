import { z } from 'zod';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const analysisCreateSchema = z
  .object({
    area_id: z.string().trim().regex(uuidRegex, 'area_id must be a valid UUID.'),
    start_date: z
      .string()
      .trim()
      .pipe(z.iso.date('start_date must be a valid YYYY-MM-DD date.')),
    end_date_exclusive: z
      .string()
      .trim()
      .pipe(z.iso.date('end_date_exclusive must be a valid YYYY-MM-DD date.')),
    time_basis: z.enum(['utc', 'local_solar', 'observation_time']).default('utc'),
    selection_policy: z.string().trim().min(1).max(100).default('standard'),
    weighting_version: z.string().trim().min(1).max(50).default('v1'),
    baseline_spec: z.record(z.string(), z.unknown()).nullable().optional(),
    weather_policy: z.record(z.string(), z.unknown()).default({}),
    news_policy: z.record(z.string(), z.unknown()).default({}),
    // The client may optionally supply these, but server enforces fixed values
    metric_key: z.string().optional(),
    grid_id: z.string().nullable().optional(),
    data_mode: z.string().optional()
  })
  .strict()
  .refine(
    (data) => data.end_date_exclusive > data.start_date,
    {
      message: 'end_date_exclusive must be strictly after start_date.',
      path: ['end_date_exclusive']
    }
  );

export type AnalysisCreateInput = z.infer<typeof analysisCreateSchema>;


export const analysisStatuses = [
  'queued',
  'running',
  'ready',
  'partial',
  'unsupported',
  'failed'
] as const;

export const analysisListQuerySchema = z
  .object({
    area_id: z.string().trim().regex(uuidRegex, 'area_id must be a valid UUID.').optional(),
    status: z.enum(analysisStatuses).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(512).optional()
  })
  .strict();

export type AnalysisListQuery = z.infer<typeof analysisListQuerySchema>;
