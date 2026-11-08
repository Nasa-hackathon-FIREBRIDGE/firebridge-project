import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue, Worker } from 'bullmq';
const database = vi.hoisted(() => ({ disconnectDatabase: vi.fn() }));
vi.mock('@firebridge/database', () => database);
import { ShutdownManager } from '../src/shutdown/shutdown-manager.js';

beforeEach(() => { vi.resetAllMocks(); database.disconnectDatabase.mockResolvedValue(undefined); });
describe('Graceful shutdown', () => {
  it('shares completion, drains producers before workers, and closes the database last', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const stop = vi.fn(() => new Promise<void>((resolve) => { calls.push('dispatcher'); release = resolve; }));
    const close = vi.fn(async () => { calls.push('worker'); });
    const queue = vi.fn(async () => { calls.push('queue'); });
    const manager = new ShutdownManager();
    manager.register({ dispatcher: { stop } as never, worker: { close } as unknown as Worker,
      queue: { close: queue } as unknown as Queue });
    const first = manager.shutdown();
    expect(manager.shutdown()).toBe(first);
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();
    release();
    await first;
    expect(calls).toEqual(['dispatcher', 'worker', 'queue']);
    expect(database.disconnectDatabase).toHaveBeenCalledOnce();
  });
  it('continues cleanup after a failure and rejects instead of reporting success', async () => {
    const manager = new ShutdownManager();
    const stop = vi.fn().mockRejectedValue(new Error('dispatcher offline'));
    const close = vi.fn().mockResolvedValue(undefined);
    const heartbeat = { stop: vi.fn().mockResolvedValue(undefined) };
    manager.register({ recovery: { stop }, worker: { close } as unknown as Worker, heartbeat });
    await expect(manager.shutdown()).rejects.toBeInstanceOf(AggregateError);
    expect(close).toHaveBeenCalledOnce();
    expect(heartbeat.stop).toHaveBeenCalledOnce();
    expect(database.disconnectDatabase).toHaveBeenCalledOnce();
  });
});
