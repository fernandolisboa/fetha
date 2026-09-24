import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { assertDisposableDatabase, DatabaseNotAllowedError } from "./lib/database-guard.mjs";
import { resolveDevDatabaseUrl } from "./lib/dev-database.mjs";

const action = "start the dev server";
const target = resolveDevDatabaseUrl(process.env, new URL("../", import.meta.url));

// Only DATABASE_URL is pinned: every other variable keeps Next.js's own
// precedence. With no DATABASE_URL anywhere the server still starts; pages
// that need the database fail as they always have.
let env = process.env;
if (target) {
  env = { ...process.env, DATABASE_URL: target.url };
  try {
    assertDisposableDatabase(env, action);
  } catch (error) {
    if (!(error instanceof DatabaseNotAllowedError)) {
      throw error;
    }
    console.error(error.message);
    process.exit(1);
  }
  console.error(
    `About to ${action} on host "${new URL(target.url).hostname}" from ${target.source}.`,
  );
}

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "--webpack", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

// Ctrl+C is how the dev server stops. A terminal signals the whole group, a
// task runner may signal only this process: either way the child is told, and
// the wrapper exits the way the child did.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
