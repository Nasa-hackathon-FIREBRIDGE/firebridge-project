import { defineConfig } from 'vitest/config';
import { configureTestInfrastructure } from '../../tests/infrastructure.js';

const integration = configureTestInfrastructure();

export default defineConfig({
  test: {
    fileParallelism: !integration,
    include: ['tests/**/*.ts'],
    exclude: ['**/*.js', 'dist/**', 'node_modules/**',
      ...(!integration ? ['tests/*integration.test.ts', 'tests/list-endpoints.test.ts'] : [])]
  }
});
