import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  if (process.env.CI) {
    console.error("DATABASE_URL is not set; refusing to continue under CI.");
    process.exit(1);
  }
  console.log("DATABASE_URL is not set; skipping integration tests.");
  process.exit(0);
}

const result = spawnSync("vitest", ["run", "--config", "vitest.integration.config.mts"], {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
