import { readLocalEnvFile } from "./local-env.mjs";

// Every script that mutates a database (reset, migrate, the integration
// suite) is bound to the specific database it is allowed to touch, not to an
// environment label. Neon's Vercel marketplace integration gives every
// project an opaque per-endpoint pooler hostname (e.g. "ep-lively-mode-…"),
// unrelated to the project's name, confirmed with `vercel env pull` against
// both environments on 2026-09-09 — so this cannot be a substring match on
// "fetha-preview"; it is an exact match against a configured allow-list, the
// same shape Feudo settled on (docs/adr/0016). Two implementers once ran
// migrations and tests against another project's database inherited from the
// shell (#49); an allow-list, not a deny-list, is what stops that.
// The production host is read from DATABASE_PRODUCTION_HOST (a GitHub
// Actions variable in CI) with this literal as the fallback; it and the
// same-named constant/fallback in src/modules/auth/env.ts change together
// (docs/adr/0016) — plain JS here, TypeScript there, so it cannot be one
// shared module without a build step for scripts.
const KNOWN_PRODUCTION_HOST_FALLBACK = "ep-sweet-sea-au3urksh-pooler.c-10.us-east-1.aws.neon.tech";
const DEFAULT_PREVIEW_HOST = "ep-lively-mode-awapxaoj-pooler.c-12.us-east-1.aws.neon.tech";

function productionHostOf(env) {
  return env.DATABASE_PRODUCTION_HOST || KNOWN_PRODUCTION_HOST_FALLBACK;
}

export class DatabaseNotAllowedError extends Error {
  constructor(action, reason) {
    super(`Refusing to ${action}: ${reason}`);
    this.name = "DatabaseNotAllowedError";
  }
}

function hostOf(databaseUrl, action) {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    throw new DatabaseNotAllowedError(action, "DATABASE_URL is not a valid URL");
  }
}

function requireHost(env, action) {
  if (!env.DATABASE_URL) {
    throw new DatabaseNotAllowedError(action, "DATABASE_URL is not set");
  }
  return hostOf(env.DATABASE_URL, action);
}

export function assertDisposableDatabase(env, action) {
  const host = requireHost(env, action);

  // No override bypasses this: a stale or copy-pasted DATABASE_URL pointing
  // at production is refused even with ALLOW_DISPOSABLE_DATABASE=1 set.
  if (host === productionHostOf(env)) {
    throw new DatabaseNotAllowedError(action, `host "${host}" is the production database`);
  }

  const allowedHost = env.DATABASE_RESET_ALLOWED_HOST || DEFAULT_PREVIEW_HOST;
  if (host === allowedHost) {
    return;
  }

  if (env.ALLOW_DISPOSABLE_DATABASE === "1") {
    return;
  }

  throw new DatabaseNotAllowedError(
    action,
    `host "${host}" is neither the fetha-preview database (${allowedHost}) nor explicitly ` +
      "allowed (set ALLOW_DISPOSABLE_DATABASE=1)",
  );
}

// Production is migrated and seeded only by migrate-production.yml, and gets
// its invites only by hand, each opting in with ALLOW_PRODUCTION_DATABASE=1;
// the opt-in reaches the production host and nothing else, so it can never be
// used to write to an unknown database.
export function assertWritableDatabase(env, action) {
  if (env.ALLOW_PRODUCTION_DATABASE !== "1") {
    assertDisposableDatabase(env, action);
    return;
  }

  const host = requireHost(env, action);
  if (host !== productionHostOf(env)) {
    throw new DatabaseNotAllowedError(
      action,
      `ALLOW_PRODUCTION_DATABASE=1 is set but host "${host}" is not the production database`,
    );
  }
}

// Entry point for the scripts: the refusal is printed as one line, not a
// stack trace, and the database actually used is named up front, since
// apps/web/.env.local silently wins over a DATABASE_URL typed in the shell.
export function guardedDatabaseEnv(assertAllowed, action, env = process.env, file) {
  const localEnv = readLocalEnvFile(file);
  const merged = { ...env, ...localEnv };
  try {
    assertAllowed(merged, action);
  } catch (error) {
    if (!(error instanceof DatabaseNotAllowedError)) {
      throw error;
    }
    console.error(error.message);
    process.exit(1);
  }
  const source = localEnv.DATABASE_URL ? "apps/web/.env.local" : "the environment";
  const overridden =
    localEnv.DATABASE_URL && env.DATABASE_URL && env.DATABASE_URL !== localEnv.DATABASE_URL
      ? ", overriding the DATABASE_URL set in the environment"
      : "";
  console.error(
    `About to ${action} on host "${new URL(merged.DATABASE_URL).hostname}" from ${source}${overridden}.`,
  );
  return merged;
}
