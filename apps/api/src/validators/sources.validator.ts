import { z } from 'zod';

export const sourceKinds = [
  'hotspots',
  'fire_mask',
  'geolocation',
  'land_cover',
  'imagery',
  'weather',
  'news',
  'incident_report'
] as const;

const httpUrlSchema = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));

export const sourceCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    provider: z.string().trim().min(1).max(200),
    kind: z.enum(sourceKinds),
    platform: z.string().trim().min(1).max(200).nullable().optional(),
    instrument: z.string().trim().min(1).max(200).nullable().optional(),
    product: z.string().trim().min(1).max(200),
    collection: z.string().trim().min(1).max(200),
    processingStream: z.string().trim().min(1).max(200),
    documentationUrl: httpUrlSchema,
    citation: z.string().trim().min(1).max(4000),
    licenseInfo: z.string().trim().min(1).max(2000),
    nativeResolutionM: z.number().positive().finite().nullable().optional(),
    schemaVersion: z.string().trim().min(1).max(100),
    metadata: z.record(z.string(), z.json()).optional()
  })
  .strict();

export const sourceListQuerySchema = z
  .object({
    kind: z.enum(sourceKinds).optional(),
    provider: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(200).optional()
  })
  .strict();
