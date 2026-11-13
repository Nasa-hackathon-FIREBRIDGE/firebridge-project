import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('Recovery activation guard', () => {
  it('accepts a blank Compose cutoff when recovery is disabled', async () => {
    vi.stubEnv('RECOVERY_ENABLED', 'false');
    vi.stubEnv('RECOVERY_CREATED_AFTER', '');
    vi.resetModules();
    const { env } = await import('../src/config/env.js');
    expect(env.RECOVERY_CREATED_AFTER).toBeUndefined();
  });
  it.each(['', 'not-a-date'])('rejects activation with cutoff %s', async (cutoff) => {
    vi.stubEnv('RECOVERY_ENABLED', 'true');
    vi.stubEnv('RECOVERY_CREATED_AFTER', cutoff);
    vi.resetModules();
    await expect(import('../src/config/env.js')).rejects.toThrow('RECOVERY_CREATED_AFTER');
  });
  it('accepts activation with an explicit timestamp', async () => {
    vi.stubEnv('RECOVERY_ENABLED', 'true');
    vi.stubEnv('RECOVERY_CREATED_AFTER', '2026-11-02T00:00:00Z');
    vi.resetModules();
    const { env } = await import('../src/config/env.js');
    expect(env.RECOVERY_ENABLED).toBe('true');
  });
});
