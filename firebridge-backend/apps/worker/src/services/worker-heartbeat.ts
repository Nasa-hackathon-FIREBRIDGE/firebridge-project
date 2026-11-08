import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const workerHeartbeatKey = () => `firebridge:worker:${hostname()}`;
export class WorkerHeartbeat {
  private client?: Redis;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private running = false;
  start(status: () => object | Promise<object>): void {
    if (this.client) return;
    const client = new Redis(env.REDIS_URL, { connectTimeout: 2500, commandTimeout: 2500, maxRetriesPerRequest: 1 });
    client.on('error', () => undefined); // Health fails by absent/expired heartbeat; no connection secrets logged.
    this.client = client;
    this.running = true;
    const beat = () => {
      this.pending = Promise.resolve().then(status).then(async (state) => {
        await client.set(workerHeartbeatKey(), JSON.stringify({ ...state, heartbeatAt: new Date().toISOString() }), 'EX', 20);
      }).catch(() => undefined).finally(() => {
        if (this.running) { this.timer = setTimeout(beat, 10000); this.timer.unref(); }
      });
    };
    beat();
  }
  async stop(): Promise<void> {
    clearTimeout(this.timer);
    this.running = false;
    await this.pending;
    if (!this.client) return;
    await this.client.del(workerHeartbeatKey()).catch(() => undefined);
    this.client.disconnect();
    this.client = undefined;
  }
}
