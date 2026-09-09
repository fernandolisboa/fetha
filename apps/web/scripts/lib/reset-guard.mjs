// The reset routine is destructive (drops the public and drizzle schemas), so
// it is bound to the specific database it is allowed to touch, not to an
// environment label: a stale or copy-pasted DATABASE_URL pointing at
// production is refused even under CI or with an explicit override.
const PREVIEW_HOST_MARKER = "fetha-preview";
const PRODUCTION_HOST_MARKER = "fetha-production";

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

  if (host.includes(PRODUCTION_HOST_MARKER)) {
    throw new DatabaseResetNotAllowedError(`host "${host}" matches the production marker`);
  }

  if (host.includes(PREVIEW_HOST_MARKER)) {
    return;
  }

  if (env.ALLOW_DATABASE_RESET === "1") {
    return;
  }

  throw new DatabaseResetNotAllowedError(
    `host "${host}" is neither the fetha-preview database nor explicitly allowed ` +
      "(set ALLOW_DATABASE_RESET=1)",
  );
}
