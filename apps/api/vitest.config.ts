import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/postgres/**', '**/*.js', 'dist/**', 'node_modules/**'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      REDIS_URL: 'redis://localhost:6379',
      PAGINATION_SECRET: 'test-pagination-secret-at-least-32-characters',
      DATABASE_URL: 'postgresql://unused:unused@localhost:1/unused',
      DEFAULT_SCOPE_KEY: 'morocco',
      CURSOR_SECRET: 'test-only-cursor-secret-at-least-32-characters'
    }
  }
});
