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
