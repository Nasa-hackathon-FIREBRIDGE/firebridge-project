import { defineConfig } from 'vitest/config';
import { configureTestInfrastructure } from '../../tests/infrastructure.js';

const integration = configureTestInfrastructure();
export default defineConfig({
  test: {
    fileParallelism: !integration,
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/postgres/**',
      'node_modules/**',
      'dist/**',
      ...(!integration
        ? [
            'tests/*integration.test.ts',
            'tests/analysis.processor.test.ts',
            'tests/outbox-dispatcher.test.ts'
          ]
        : [])
    ]
  }
});
