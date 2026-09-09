// The reset routine is destructive (drops the public and drizzle schemas),
// so it is bound to the specific database it is allowed to touch, not to an
// environment label. Neon's Vercel marketplace integration gives every
// project an opaque per-endpoint pooler hostname (e.g. "ep-lively-mode-…"),
// unrelated to the project's name, confirmed with `vercel env pull` against
// both environments on 2026-09-09 — so this cannot be a substring match on
// "fetha-preview"; it is an exact match against a configured allow-list, the
// same shape Feudo settled on (docs/adr/0016).
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

export class DatabaseResetNotAllowedError extends Error {
  constructor(reason) {
    super(`Refusing to reset the database: ${reason}`);
    this.name = "DatabaseResetNotAllowedError";
  }
}

function hostOf(databaseUrl) {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    throw new DatabaseResetNotAllowedError("DATABASE_URL is not a valid URL");
  }
}

export function assertDatabaseResetAllowed(env = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new DatabaseResetNotAllowedError("DATABASE_URL is not set");
  }

  const host = hostOf(databaseUrl);

  // No override bypasses this: a stale or copy-pasted DATABASE_URL pointing
  // at production is refused even with ALLOW_DATABASE_RESET=1 set.
  if (host === productionHostOf(env)) {
    throw new DatabaseResetNotAllowedError(`host "${host}" is the production database`);
  }

  const allowedHost = env.DATABASE_RESET_ALLOWED_HOST || DEFAULT_PREVIEW_HOST;
  if (host === allowedHost) {
    return;
  }

  if (env.ALLOW_DATABASE_RESET === "1") {
    return;
  }

  throw new DatabaseResetNotAllowedError(
    `host "${host}" is neither the fetha-preview database (${allowedHost}) nor explicitly ` +
      "allowed (set ALLOW_DATABASE_RESET=1)",
  );
}
