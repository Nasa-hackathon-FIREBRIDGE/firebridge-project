import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.ts'],
    exclude: ['**/*.js', 'dist/**', 'node_modules/**']
  }
});
