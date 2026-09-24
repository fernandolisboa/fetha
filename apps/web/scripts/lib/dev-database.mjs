import { readLocalEnvFile } from "./local-env.mjs";

// The order the dev server will actually see: the wrapper passes the winner
// explicitly, and Next.js never overrides a variable already in the
// environment, so .env.local comes first (#102), then the shell, then the
// files Next.js would otherwise load on its own.
const FILES_AFTER_SHELL = [".env.development.local", ".env.development", ".env"];

export function resolveDevDatabaseUrl(env, appDir) {
  const fromFile = (name) => readLocalEnvFile(new URL(name, appDir)).DATABASE_URL;
  const candidates = [
    ["apps/web/.env.local", fromFile(".env.local")],
    ["the environment", env.DATABASE_URL],
    ...FILES_AFTER_SHELL.map((name) => [`apps/web/${name}`, fromFile(name)]),
  ];
  const found = candidates.find(([, url]) => url);
  return found ? { source: found[0], url: found[1] } : undefined;
}
