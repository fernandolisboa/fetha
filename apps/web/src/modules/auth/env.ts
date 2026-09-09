export interface AuthEnv {
  BETTER_AUTH_URL?: string;
  VERCEL_URL?: string;
  VERCEL_ENV?: string;
  E2E_SECRET?: string;
  MAILER?: string;
  DATABASE_URL?: string;
  DATABASE_PRODUCTION_HOST?: string;
  [key: string]: string | undefined;
}

const DEFAULT_LOCAL_BASE_URL = "http://localhost:3000";

// Neon's Vercel marketplace integration gives every project an opaque
// per-endpoint pooler hostname, unrelated to the project's name (confirmed
// with `vercel env pull` on 2026-09-09, docs/adr/0016), so this is an exact
// match against the real production host, not a substring marker. Read from
// DATABASE_PRODUCTION_HOST (a GitHub Actions variable in CI) with this
// literal as the fallback; it and the same-named constant/fallback in
// scripts/lib/reset-guard.mjs change together (docs/adr/0016).
const PRODUCTION_DATABASE_HOST_FALLBACK =
  "ep-sweet-sea-au3urksh-pooler.c-10.us-east-1.aws.neon.tech";

function readOptionalEnvValue(env: AuthEnv, key: string): string | undefined {
  const raw = env[key];
  return raw === undefined || raw === "" ? undefined : raw;
}

// Preview and other non-production Vercel deployments never set BETTER_AUTH_URL
// (it would have to be pinned per deployment); Vercel sets VERCEL_URL to that
// deployment's own hostname instead.
export function readAuthBaseUrl(env: AuthEnv = process.env): string {
  const explicit = readOptionalEnvValue(env, "BETTER_AUTH_URL");
  if (explicit) {
    return explicit;
  }
  const vercelUrl = readOptionalEnvValue(env, "VERCEL_URL");
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }
  return DEFAULT_LOCAL_BASE_URL;
}

export function isProductionDeployment(env: AuthEnv = process.env): boolean {
  return readOptionalEnvValue(env, "VERCEL_ENV") === "production";
}

export function readE2ESecret(env: AuthEnv = process.env): string | undefined {
  return readOptionalEnvValue(env, "E2E_SECRET");
}

export function isProductionDatabaseHost(env: AuthEnv = process.env): boolean {
  const databaseUrl = readOptionalEnvValue(env, "DATABASE_URL");
  if (!databaseUrl) {
    return false;
  }
  const productionHost =
    readOptionalEnvValue(env, "DATABASE_PRODUCTION_HOST") ?? PRODUCTION_DATABASE_HOST_FALLBACK;
  try {
    return new URL(databaseUrl).hostname === productionHost;
  } catch {
    return false;
  }
}
