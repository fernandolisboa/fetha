import { spawnSync } from "node:child_process";

import { assertDisposableDatabase, guardedDatabaseEnv } from "./lib/database-guard.mjs";
import { withLocalEnvFile } from "./lib/local-env.mjs";

// Next.js loads apps/web/.env.local without overriding what the shell already
// exports, so a DATABASE_URL another project left in the shell would reach the
// dev server and receive its writes (#102). With no DATABASE_URL at all the
// server still starts; pages that need the database fail as they always have.
const env = withLocalEnvFile().DATABASE_URL
  ? guardedDatabaseEnv(assertDisposableDatabase, "start the dev server")
  : process.env;

const result = spawnSync("next", ["dev", "--webpack", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env,
});

process.exit(result.status ?? 1);
