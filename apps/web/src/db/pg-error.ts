export interface PostgresError {
  code: string;
  severity: string;
  constraint?: string;
}

// The Neon driver's own error class always carries `severity` alongside
// `code`; an incidental JS error with a string `.code` (Node's `ENOENT`, for
// instance) essentially never does.
function isPostgresErrorShape(value: unknown): value is PostgresError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "severity" in value &&
    typeof value.severity === "string"
  );
}

// Drizzle wraps every driver-level failure in DrizzleQueryError, whose own
// shape carries no SQLSTATE; the Postgres error lands on `.cause`.
export function postgresErrorOf(error: unknown): PostgresError | null {
  const cause = error instanceof Error ? error.cause : undefined;
  if (isPostgresErrorShape(cause)) {
    return cause;
  }
  return isPostgresErrorShape(error) ? error : null;
}

const MAX_SAFE_MESSAGE_LENGTH = 200;

// Drizzle's own `DrizzleQueryError` message is `Failed query: <sql>\nparams:
// <params>` — the bound statement itself, which for a market-data write can
// carry a full day's ticker/price rows or a user's id. That string must
// never be stored, returned or logged, whether it is the caught error's own
// message (a query that failed for a reason the driver never turned into a
// Postgres error, e.g. a dropped connection mid-query) or sits one level
// down as `.cause` on something else that wraps it. A duck-typed check on
// `.query` matches drizzle-orm's real error class (which also carries
// `.params`, but `.query` alone is enough to identify it) without importing
// it; the message pattern is a second, cheaper check for anything shaped the
// same way without that own property.
function isDrizzleQueryErrorShape(value: unknown): boolean {
  if (!(value instanceof Error)) {
    return false;
  }
  if ("query" in value && typeof (value as { query: unknown }).query === "string") {
    return true;
  }
  return value.message.startsWith("Failed query:");
}

function leaksQuery(error: unknown): boolean {
  if (isDrizzleQueryErrorShape(error)) {
    return true;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  return isDrizzleQueryErrorShape(cause);
}

function truncate(message: string, maxLength: number): string {
  return message.length > maxLength ? `${message.slice(0, maxLength)}…` : message;
}

// The one way a caught error that may come from the database becomes a
// string that is stored, returned or logged (`ingestion_runs.error`, the
// nightly job's outcome, job logs): a Postgres error is reduced to its
// SQLSTATE (plus the violated constraint when the driver reports one), never
// its own message, since that message is driver-formatted free text that can
// itself echo back bound values.
export function safeDbErrorMessage(error: unknown): string {
  const postgresError = postgresErrorOf(error);
  if (postgresError) {
    return postgresError.constraint
      ? `${postgresError.code} (${postgresError.constraint})`
      : postgresError.code;
  }
  if (leaksQuery(error)) {
    return "database query failed";
  }
  if (error instanceof Error && error.message.length > 0) {
    return truncate(error.message, MAX_SAFE_MESSAGE_LENGTH);
  }
  return "unknown error";
}
