import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  MAX_CURSOR_LENGTH
} from '../src/utils/cursor.js';
import { InvalidCursorError } from '../src/errors/app-error.js';

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-bytes-long';

describe('Signed Cursor Utilities', () => {
  it('encodes and decodes a valid cursor with full payload roundtrip', () => {
    const payload = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      filters: { kind: 'hotspots', provider: 'NASA' }
    };

    const cursor = encodeCursor(payload, TEST_SECRET);
    expect(typeof cursor).toBe('string');
    expect(cursor.startsWith('v1.')).toBe(true);

    const decoded = decodeCursor(cursor, { kind: 'hotspots', provider: 'NASA' }, TEST_SECRET);
    expect(decoded.id).toBe(payload.id);
    expect(decoded.filters).toEqual(payload.filters);
  });

  it('rejects a cursor with an invalid or incorrect signature', () => {
    const cursor = encodeCursor({ id: 'item-1' }, TEST_SECRET);
    const differentSecret = 'completely-different-secret-key-32b-long';

    expect(() => decodeCursor(cursor, undefined, differentSecret)).toThrow(InvalidCursorError);
  });

  it('rejects an altered or tampered cursor payload', () => {
    const cursor = encodeCursor({ id: 'original-id' }, TEST_SECRET);
    const parts = cursor.split('.');

    // Tamper with data part
    const tamperedPayload = Buffer.from(
      JSON.stringify({ v: 'v1', id: 'tampered-id' }),
      'utf-8'
    ).toString('base64url');

    const tamperedCursor = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    expect(() => decodeCursor(tamperedCursor, undefined, TEST_SECRET)).toThrow(InvalidCursorError);
  });

  it('rejects a malformed cursor string', () => {
    expect(() => decodeCursor('', undefined, TEST_SECRET)).toThrow(InvalidCursorError);
    expect(() => decodeCursor('not-a-cursor', undefined, TEST_SECRET)).toThrow(InvalidCursorError);
    expect(() => decodeCursor('v1.onlyonepart', undefined, TEST_SECRET)).toThrow(InvalidCursorError);
    expect(() => decodeCursor('v1.data.sig.extra', undefined, TEST_SECRET)).toThrow(InvalidCursorError);
  });

  it('rejects a cursor with an unsupported version', () => {
    const parts = encodeCursor({ id: 'item-1' }, TEST_SECRET).split('.');
    const wrongVersionCursor = `v2.${parts[1]}.${parts[2]}`;

    expect(() => decodeCursor(wrongVersionCursor, undefined, TEST_SECRET)).toThrow(InvalidCursorError);
  });

  it('throws an error if secret is missing', () => {
    expect(() => encodeCursor({ id: 'item-1' }, '')).toThrow(/Pagination secret is not configured/);
    expect(() => decodeCursor('v1.data.sig', undefined, '')).toThrow(/Pagination secret is not configured/);
  });

  it('rejects a cursor exceeding the maximum allowed size limit', () => {
    const oversizedCursor = 'v1.' + 'a'.repeat(MAX_CURSOR_LENGTH + 10) + '.sig';
    expect(() => decodeCursor(oversizedCursor, undefined, TEST_SECRET)).toThrow(InvalidCursorError);
  });

  it('enforces query filter coherence when kind filter does not match', () => {
    const cursor = encodeCursor(
      { id: 'source-1', filters: { kind: 'hotspots', provider: 'NASA' } },
      TEST_SECRET
    );

    // Mismatched kind in active request
    expect(() =>
      decodeCursor(cursor, { kind: 'fire_mask', provider: 'NASA' }, TEST_SECRET)
    ).toThrow(/Cursor does not match requested query kind filter/);
  });

  it('enforces query filter coherence when provider filter does not match', () => {
    const cursor = encodeCursor(
      { id: 'source-1', filters: { kind: 'hotspots', provider: 'NASA' } },
      TEST_SECRET
    );

    // Mismatched provider in active request
    expect(() =>
      decodeCursor(cursor, { kind: 'hotspots', provider: 'ESA' }, TEST_SECRET)
    ).toThrow(/Cursor does not match requested query provider filter/);
  });

  it('supports simulating multiple contiguous pages without duplicate items or omissions', () => {
    const dataset = [
      { id: 'item-01' },
      { id: 'item-02' },
      { id: 'item-03' },
      { id: 'item-04' },
      { id: 'item-05' }
    ];

    const pageSize = 2;
    const collectedIds: string[] = [];
    let currentCursor: string | null = null;

    // Page 1
    const page1 = dataset.slice(0, pageSize + 1);
    const hasMore1 = page1.length > pageSize;
    const items1 = page1.slice(0, pageSize);
    collectedIds.push(...items1.map((i) => i.id));
    currentCursor = hasMore1 ? encodeCursor({ id: items1[items1.length - 1].id }, TEST_SECRET) : null;

    // Page 2
    expect(currentCursor).not.toBeNull();
    const decoded1 = decodeCursor(currentCursor!, undefined, TEST_SECRET);
    const page2Dataset = dataset.filter((i) => i.id > decoded1.id);
    const page2 = page2Dataset.slice(0, pageSize + 1);
    const hasMore2 = page2.length > pageSize;
    const items2 = page2.slice(0, pageSize);
    collectedIds.push(...items2.map((i) => i.id));
    currentCursor = hasMore2 ? encodeCursor({ id: items2[items2.length - 1].id }, TEST_SECRET) : null;

    // Page 3
    expect(currentCursor).not.toBeNull();
    const decoded2 = decodeCursor(currentCursor!, undefined, TEST_SECRET);
    const page3Dataset = dataset.filter((i) => i.id > decoded2.id);
    const page3 = page3Dataset.slice(0, pageSize + 1);
    const hasMore3 = page3.length > pageSize;
    const items3 = page3.slice(0, pageSize);
    collectedIds.push(...items3.map((i) => i.id));
    currentCursor = hasMore3 ? encodeCursor({ id: items3[items3.length - 1].id }, TEST_SECRET) : null;

    // Last page must have no next cursor
    expect(currentCursor).toBeNull();
    expect(collectedIds).toEqual(['item-01', 'item-02', 'item-03', 'item-04', 'item-05']);
  });
});

