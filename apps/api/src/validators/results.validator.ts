import { z } from 'zod';
import { exportInputSchema, resultsConfig, uuidSchema } from '@firebridge/results';

export { exportInputSchema };
export const resultIdSchema = z.object({ id: uuidSchema }).strict();
const coordinate = z.string().regex(/^(0|[1-9][0-9]{0,7})$/).transform(Number);
export const tileParamsSchema = z.object({
  id: uuidSchema,
  layer: z.literal('detections'),
  z: coordinate.refine((value) => value <= resultsConfig.TILE_MAX_ZOOM),
  x: coordinate,
  y: coordinate
}).strict().refine(({ z, x, y }) => x < 2 ** z && y < 2 ** z, 'Invalid XYZ coordinates.');
export type TileParams = z.infer<typeof tileParamsSchema>;

export function parseResultInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Invalid Phase 4 request.');
  return parsed.data;
}

import { ValidationError } from '../errors/app-error.js';
