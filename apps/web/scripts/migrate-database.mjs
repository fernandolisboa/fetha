import { spawnSync } from "node:child_process";

import { assertWritableDatabase, guardedDatabaseEnv } from "./lib/database-guard.mjs";

const env = guardedDatabaseEnv(assertWritableDatabase, "migrate the database");

const result = spawnSync("drizzle-kit", ["migrate"], { stdio: "inherit", shell: true, env });

process.exit(result.status ?? 1);
