import './config/env.js';
import { Redis } from 'ioredis';
import { env } from './config/env.js';
import { workerHeartbeatKey } from './services/worker-heartbeat.js';

const client = new Redis(env.REDIS_URL, { connectTimeout: 2500, commandTimeout: 2500, maxRetriesPerRequest: 1, retryStrategy: () => null });
client.on('error', () => undefined);
try {
  const value = await client.get(workerHeartbeatKey());
  const state: unknown = value ? JSON.parse(value) : null;
  const processors = state && typeof state === 'object' && 'processorsRegistered' in state ? state.processorsRegistered : null;
  const healthy = state && typeof state === 'object' && 'status' in state && state.status === 'running'
    && Array.isArray(processors) && ['analysis.requested', 'export.requested'].every((name) => processors.includes(name));
  if (!healthy) process.exitCode = 1;
} catch { process.exitCode = 1; }
finally { client.disconnect(); }
