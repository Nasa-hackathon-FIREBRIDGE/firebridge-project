import { z } from 'zod';
import { uuidSchema } from '@firebridge/results';

export const analysisJobSchema = z
  .object({
    analysis_id: uuidSchema,
    job_id: uuidSchema,
    area_id: uuidSchema,
    metric_key: z.literal('native_detections_v1'),
    start_date: z.iso.date(),
    end_date_exclusive: z.iso.date()
  })
  .strict()
  .refine((data) => data.end_date_exclusive > data.start_date);

export type AnalysisJobPayload = z.infer<typeof analysisJobSchema>;
export const exportJobSchema = z.object({ job_id: uuidSchema }).strict();

export function parseQueuePayload(eventType: string, payload: unknown) {
  if (eventType === 'analysis.requested') return analysisJobSchema.parse(payload);
  if (['export.requested', 'ingestion.plan.requested', 'explanation.requested'].includes(eventType))
    return exportJobSchema.parse(payload);
  throw new Error('UNSUPPORTED_QUEUE_EVENT');
}
