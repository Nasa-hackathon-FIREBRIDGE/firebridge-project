import { z } from 'zod';
import { uuidSchema } from '@firebridge/results';

export const jobsListQuerySchema = z.object({
  kind: z.enum(['analysis', 'explanation', 'export', 'backfill', 'refresh']).optional(),
  status: z.enum(['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled']).optional(),
  analysis_id: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional()
}).strict();
export type JobsListQuery = z.infer<typeof jobsListQuerySchema>;
