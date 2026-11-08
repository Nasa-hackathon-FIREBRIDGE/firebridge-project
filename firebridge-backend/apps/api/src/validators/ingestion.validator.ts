import { z } from 'zod';
import { ApiError } from '../utils/response.js';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const uuid = z
  .string()
  .uuid()
  .transform((v) => v.toLowerCase());
export const utc = z
  .string()
  .max(24)
  .transform((value, ctx) => {
    const date = new Date(value);
    if (
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value.slice(0, 10)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use a valid UTC timestamp ending in Z.'
      });
      return z.NEVER;
    }
    return date.toISOString();
  });
const budget = z
  .object({
    max_chunks: z.number().int().min(1).max(366),
    max_bytes: z.number().int().min(1).max(1_000_000_000_000)
  })
  .strict();
const window = { start: utc, end_exclusive: utc };
export const backfillSchema = z
  .object({
    feed_id: identifier,
    area_id: uuid,
    scope_key: identifier,
    ...window,
    source_ids: z
      .array(identifier)
      .min(1)
      .max(100)
      .transform((v) => [...new Set(v)].sort()),
    products: z
      .array(identifier)
      .min(1)
      .max(100)
      .transform((v) => [...new Set(v)].sort()),
    collection: z.string().min(1).max(64),
    adapter_options: z.object({}).strict().default({}),
    resource_budget: budget
  })
  .strict();
export const refreshSchema = z
  .object({
    mode: z.enum(['poll', 'repair', 'reconcile']),
    start: utc.optional(),
    end_exclusive: utc.optional(),
    reason: z.enum(['manual', 'gap_repair', 'provider_revision']).default('manual'),
    resource_budget: budget
  })
  .strict()
  .refine((v) => Boolean(v.start) === Boolean(v.end_exclusive));
const pagination = {
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
    .default('50')
    .transform(Number),
  cursor: z.string().min(1).max(4096).optional()
};
export const subscriptionsQuery = z
  .object({
    ...pagination,
    scope_key: identifier.optional(),
    feed_id: identifier.optional(),
    mode: z.enum(['backfill', 'incremental', 'reconciliation']).optional(),
    state: z.enum(['active', 'paused', 'retired', 'unverified']).optional(),
    enabled: z.enum(['true', 'false']).optional()
  })
  .strict();
export const gapsQuery = z
  .object({
    ...pagination,
    scope_key: identifier.optional(),
    feed_id: identifier.optional(),
    status: z.enum(['open', 'retrying', 'resolved', 'accepted_unavailable']).optional(),
    start: utc.optional(),
    end_exclusive: utc.optional()
  })
  .strict();
export const availabilityQuery = z
  .object({
    scope_key: identifier,
    start: utc.optional(),
    end_exclusive: utc.optional()
  })
  .strict();
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(422, 'INVALID_REQUEST', 'Invalid ingestion request parameters.');
  return result.data;
}
export function validateWindow(start?: string, end?: string) {
  if (start && end && start >= end)
    throw new ApiError(
      422,
      'INVALID_WINDOW',
      'The UTC window must have start before end_exclusive.'
    );
}
export type BackfillInput = z.infer<typeof backfillSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type SubscriptionsQuery = z.infer<typeof subscriptionsQuery>;
export type GapsQuery = z.infer<typeof gapsQuery>;
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;
