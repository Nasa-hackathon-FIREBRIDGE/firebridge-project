import { z } from 'zod';

export const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
export const exportFormatSchema = z.enum(['csv', 'geojson', 'parquet']);
export const exportInputSchema = z.object({
  format: exportFormatSchema,
  filters: z.object({
    source_id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.:-]+$/).optional(),
    day_night: z.enum(['day', 'night', 'unknown']).optional()
  }).strict().default({}),
  options: z.object({}).strict().default({})
}).strict();

export type ExportInput = z.infer<typeof exportInputSchema>;
export type ExportFormat = z.infer<typeof exportFormatSchema>;
export interface ResultContext {
  id: string;
  status: string;
  time_basis: string;
  metric_key: string;
  selection_policy: string;
  grid_id: string | null;
  release_id: string;
  component_status: string | null;
  release_status: string;
  completed_at: Date | null;
  cache_key: string;
}

export interface DetectionRow {
  id: string;
  source_id: string;
  acquired_at: string;
  longitude: number;
  latitude: number;
  confidence_raw: string | null;
  day_night: string | null;
  frp_mw: number | null;
}

export function resultAvailability(context: ResultContext): 'ready' | 'pending' | 'unsupported' {
  if (!['ready', 'partial'].includes(context.status) || context.component_status !== 'ready' || context.release_status !== 'published') return 'pending';
  if (context.time_basis !== 'utc' || context.metric_key !== 'native_detections_v1'
    || context.selection_policy !== 'standard' || context.grid_id !== null) return 'unsupported';
  return 'ready';
}

export const exportFormats = {
  csv: { mime: 'text/csv; charset=utf-8', extension: 'csv' },
  geojson: { mime: 'application/geo+json', extension: 'geojson' },
  parquet: { mime: 'application/vnd.apache.parquet', extension: 'parquet' }
} as const;
