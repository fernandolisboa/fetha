import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.{test,spec,bench}.ts"],
      thresholds: {
        lines: 95,
        branches: 95,
      },
    },
  },
});
