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
    // Distinguishes this run from the unit config for isUnitTestEnv
    // (src/modules/auth/env.ts): rate limiting stays on here, against the
    // real fetha-preview database, unlike under plain `vitest` (docs/adr/0016).
    env: { VITEST_INTEGRATION: "1" },
  },
});
