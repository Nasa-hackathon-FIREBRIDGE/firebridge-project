import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError, ValidationError } from '../errors/app-error.js';
const signature = (id: string, expires: number) => createHmac('sha256', env.CURSOR_SECRET).update(`download:v1:${id}:${expires}`).digest('hex');
export function createDownloadLink(id: string, fileExpiresAt: Date): string | null {
  const expires = Math.min(Math.floor(Date.now() / 1000) + 300, Math.floor(fileExpiresAt.getTime() / 1000));
  if (expires <= Math.floor(Date.now() / 1000)) return null;
  return `/api/v1/jobs/${id}/download?expires=${expires}&signature=${signature(id, expires)}`;
}
const querySchema = z.object({ expires: z.string().regex(/^[0-9]{1,12}$/).transform(Number), signature: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export function validateDownloadLink(id: string, query: unknown): void {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) throw new ValidationError('Use the download URL returned by GET /jobs/{id}.', 'INVALID_DOWNLOAD_LINK');
  const { expires, signature: supplied } = parsed.data;
  if (!timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(id, expires), 'hex'))) throw new ValidationError('Invalid download link.', 'INVALID_DOWNLOAD_LINK');
  const now = Math.floor(Date.now() / 1000);
  if (expires <= now) throw new AppError(410, 'DOWNLOAD_LINK_EXPIRED', 'Download link expired. Request a new link from the job endpoint.');
  if (expires > now + 305) throw new ValidationError('Invalid download link lifetime.', 'INVALID_DOWNLOAD_LINK');
}
