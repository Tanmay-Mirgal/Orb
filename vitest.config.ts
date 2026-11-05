import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Same `@/` alias as apps/web/tsconfig.json so server code can be tested without Next.
  resolve: { alias: { '@': path.resolve(__dirname, 'apps/web/src') } },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
