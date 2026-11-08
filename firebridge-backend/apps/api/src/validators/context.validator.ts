import { z } from 'zod';
import { ApiError } from '../utils/response.js';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v;
  });
const page = {
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
    .default('50')
    .transform(Number),
  cursor: z.string().min(1).max(4096).optional()
};
export const coverageQuery = z
  .object({
    start_date: day.optional(),
    end_date_exclusive: day.optional(),
    cell_id: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .optional()
  })
  .strict();
export const cellQuery = z
  .object({ ...page, start_date: day.optional(), end_date_exclusive: day.optional() })
  .strict();
export const comparisonQuery = z
  .object({
    view: z
      .enum(['native_counts', 'common_response', 'withheld_reference'])
      .default('native_counts'),
    resolution: z.enum(['week', 'month']).default('week')
  })
  .strict();
export const weatherQuery = z
  .object({
    ...page,
    variables: z
      .string()
      .regex(/^[A-Za-z0-9_]+(?:,[A-Za-z0-9_]+)*$/)
      .max(1024)
      .optional(),
    resolution: z.enum(['hour', 'day', 'period']).default('hour'),
    context: z.enum(['historical', 'recent', 'both']).default('both')
  })
  .strict();
export const reportsQuery = z
  .object({
    ...page,
    relation: z
      .enum(['candidate', 'consistent', 'conflicting', 'unresolved', 'rejected'])
      .optional(),
    review_status: z.enum(['unreviewed', 'reviewed', 'rejected']).optional()
  })
  .strict();
export const explanationBody = z
  .object({
    language: z.enum(['fr', 'en']).default('fr'),
    question: z.string().trim().max(512).default('')
  })
  .strict();
export function parseContext<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(422, 'INVALID_REQUEST', 'Invalid context parameters.');
  return parsed.data;
}
export type CoverageQuery = z.infer<typeof coverageQuery>;
export type CellQuery = z.infer<typeof cellQuery>;
export type ComparisonQuery = z.infer<typeof comparisonQuery>;
export type WeatherQuery = z.infer<typeof weatherQuery>;
export type ReportsQuery = z.infer<typeof reportsQuery>;
export type ExplanationInput = z.infer<typeof explanationBody>;
