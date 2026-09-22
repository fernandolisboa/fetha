import { spawnSync } from "node:child_process";

import { assertMigrationAllowed } from "./lib/database-guard.mjs";
import { withLocalEnvFile } from "./lib/local-env.mjs";

const env = withLocalEnvFile();
assertMigrationAllowed(env);

const result = spawnSync("drizzle-kit", ["migrate"], { stdio: "inherit", shell: true, env });

process.exit(result.status ?? 1);
