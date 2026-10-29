import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { InvalidCursorError } from '../errors/app-error.js';

export const CURSOR_VERSION = 'v1';
export const MAX_CURSOR_LENGTH = 512;

export interface CursorFilters {
  kind?: string;
  provider?: string;
}

export interface CursorPayload {
  v: string;
  id: string;
  filters?: CursorFilters;
  ts?: number;
}

/**
 * Encodes a pagination payload into a signed, versioned base64url cursor.
 * Format: v1.<encoded_payload>.<signature>
 */
export function encodeCursor(
  payload: { id: string; filters?: CursorFilters },
  secret: string = env.PAGINATION_SECRET
): string {
  if (!secret) {
    throw new Error('Pagination secret is not configured.');
  }

  const data: CursorPayload = {
    v: CURSOR_VERSION,
    id: payload.id,
    filters: payload.filters && Object.keys(payload.filters).length > 0 ? payload.filters : undefined,
    ts: Date.now()
  };

  const serialized = JSON.stringify(data);
  const dataPart = Buffer.from(serialized, 'utf-8').toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${CURSOR_VERSION}.${dataPart}`)
    .digest('base64url');

  return `${CURSOR_VERSION}.${dataPart}.${signature}`;
}

/**
 * Decodes and cryptographically verifies a signed cursor.
 * Throws InvalidCursorError if the cursor is malformed, has an invalid signature,
 * wrong version, or if its embedded filters do not match the active query filters.
 */
export function decodeCursor(
  cursor: string,
  expectedFilters?: CursorFilters,
  secret: string = env.PAGINATION_SECRET
): { id: string; filters?: CursorFilters } {
  if (!secret) {
    throw new Error('Pagination secret is not configured.');
  }

  if (typeof cursor !== 'string' || cursor.length === 0) {
    throw new InvalidCursorError('Pagination cursor cannot be empty.');
  }

  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw new InvalidCursorError('Pagination cursor exceeds maximum allowed length.');
  }

  const parts = cursor.split('.');
  if (parts.length !== 3) {
    throw new InvalidCursorError('Malformed pagination cursor format.');
  }

  const [version, dataPart, signature] = parts;

  if (version !== CURSOR_VERSION) {
    throw new InvalidCursorError(`Unsupported pagination cursor version: ${version}.`);
  }

  // Verify HMAC signature using timingSafeEqual to avoid timing side-channels
  const expectedSignature = createHmac('sha256', secret)
    .update(`${version}.${dataPart}`)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature, 'utf-8');
  const expectedSigBuffer = Buffer.from(expectedSignature, 'utf-8');

  if (sigBuffer.length !== expectedSigBuffer.length || !timingSafeEqual(sigBuffer, expectedSigBuffer)) {
    throw new InvalidCursorError('Invalid or tampered pagination cursor signature.');
  }

  let payload: CursorPayload;
  try {
    const jsonStr = Buffer.from(dataPart, 'base64url').toString('utf-8');
    payload = JSON.parse(jsonStr) as CursorPayload;
  } catch {
    throw new InvalidCursorError('Malformed pagination cursor payload.');
  }

  if (!payload || typeof payload.id !== 'string' || payload.id.trim().length === 0) {
    throw new InvalidCursorError('Invalid pagination cursor data.');
  }

  // Validate filter coherence: cursor created for one filter cannot be reused under another
  if (expectedFilters) {
    if (expectedFilters.kind !== undefined && payload.filters?.kind !== expectedFilters.kind) {
      throw new InvalidCursorError('Cursor does not match requested query kind filter.');
    }
    if (expectedFilters.provider !== undefined && payload.filters?.provider !== expectedFilters.provider) {
      throw new InvalidCursorError('Cursor does not match requested query provider filter.');
    }
  }

  return {
    id: payload.id,
    filters: payload.filters
  };
}

