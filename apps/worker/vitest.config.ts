import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { env: { NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379' } }
});
