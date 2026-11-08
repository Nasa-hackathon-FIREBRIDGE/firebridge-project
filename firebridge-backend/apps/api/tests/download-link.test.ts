import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDownloadLink, validateDownloadLink } from '../src/utils/download-link.js';
const id = '33333333-3333-4333-8333-333333333333';
afterEach(() => vi.useRealTimers());
describe('Short-lived public download links', () => {
  it('binds the resource and expiration, rejects tampering, and expires after five minutes', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    const link = createDownloadLink(id, new Date(Date.now() + 3600000))!;
    const query = Object.fromEntries(new URL(link, 'http://localhost').searchParams);
    expect(() => validateDownloadLink(id, query)).not.toThrow();
    expect(() => validateDownloadLink('44444444-4444-4444-8444-444444444444', query)).toThrow();
    expect(() => validateDownloadLink(id, { ...query, signature: '0'.repeat(64) })).toThrow();
    vi.advanceTimersByTime(301000);
    expect(() => validateDownloadLink(id, query)).toThrow('expired');
  });
  it('does not issue a link for an expired file and rejects path/query additions', () => {
    expect(createDownloadLink(id, new Date(0))).toBeNull();
    expect(() => validateDownloadLink(id, { expires: '1', signature: '../secret' })).toThrow();
  });
});
