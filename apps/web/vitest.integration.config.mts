import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20000,
  },
});
