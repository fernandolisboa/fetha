import { spawnSync } from "node:child_process";

import { assertWritableDatabase, guardedDatabaseEnv } from "./lib/database-guard.mjs";

const env = guardedDatabaseEnv(assertWritableDatabase, "migrate the database");
// drizzle-kit loads apps/web/.env through dotenv, which honours these two
// variables: with them it could replace the DATABASE_URL guarded above.
delete env.DOTENV_CONFIG_OVERRIDE;
delete env.DOTENV_CONFIG_PATH;

const result = spawnSync("drizzle-kit", ["migrate"], { stdio: "inherit", shell: true, env });

process.exit(result.status ?? 1);
