import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/postgres/**', 'node_modules/**', 'dist/**'],
    env: {
      NODE_ENV: 'test',
      REDIS_URL: 'redis://localhost:1',
      DATABASE_URL: 'postgresql://unused:unused@localhost:1/unused'
    }
  }
});
