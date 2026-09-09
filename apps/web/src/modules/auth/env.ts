export interface AuthEnv {
  BETTER_AUTH_URL?: string;
  VERCEL_URL?: string;
  VERCEL_ENV?: string;
  E2E_SECRET?: string;
  MAILER?: string;
  DATABASE_URL?: string;
  [key: string]: string | undefined;
}

const DEFAULT_LOCAL_BASE_URL = "http://localhost:3000";

// fetha-preview and CI never carry a database host that could be mistaken
// for production; this marker mirrors the one the reset guard refuses to
// touch (apps/web/scripts/lib/reset-guard.mjs).
const PRODUCTION_DATABASE_HOST_MARKER = "fetha-production";

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
  try {
    return new URL(databaseUrl).hostname.includes(PRODUCTION_DATABASE_HOST_MARKER);
  } catch {
    return false;
  }
}
