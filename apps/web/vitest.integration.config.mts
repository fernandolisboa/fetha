import path from "node:path";

import { defineConfig } from "vitest/config";

import { assertDisposableDatabase, guardedDatabaseEnv } from "./scripts/lib/database-guard.mjs";
import { readLocalEnvFile } from "./scripts/lib/local-env.mjs";

// Guarded here, not only in scripts/run-integration-tests.mjs, so that
// running a single file with `vitest run --config` directly is refused too,
// before any test file (and so any query) is loaded.
guardedDatabaseEnv(assertDisposableDatabase, "run integration tests");
const localEnv = readLocalEnvFile();

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    env: localEnv,
    fileParallelism: false,
    testTimeout: 20000,
  },
});
