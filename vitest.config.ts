import { defineConfig } from "vitest/config";
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/types.ts"],
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      'openclaw/plugin-sdk': path.resolve(__dirname, 'test-mocks/openclaw-plugin-sdk.ts'),
    },
  },
});