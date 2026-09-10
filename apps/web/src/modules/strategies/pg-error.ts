interface PgDriverError {
  code: string;
  severity: string;
}

// Distinguishes a genuine Postgres driver error from any JS error that
// merely happens to carry a string `.code` (Node's `ENOENT`, for instance):
// the Neon serverless driver's own error class always carries `severity`
// alongside `code`, and an incidental error essentially never does.
function isPgDriverErrorShape(value: unknown): value is PgDriverError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "severity" in value &&
    typeof value.severity === "string"
  );
}

const CONFLICT_CODES = new Set(["23505", "40001", "40P01"]);

export type PersistenceErrorOutcome = "conflict" | "unavailable" | null;

// Drizzle wraps every driver-level failure in DrizzleQueryError, whose own
// shape carries no SQLSTATE; the actual Postgres error lands on `.cause`.
// Anything that is not recognizably that shape (a bug, an out-of-memory
// error, a programming mistake) is not this function's to classify — the
// caller rethrows it rather than reporting a misleading "unavailable".
export function classifyPersistenceError(error: unknown): PersistenceErrorOutcome {
  const candidate = error instanceof Error && "cause" in error ? error.cause : error;
  if (!isPgDriverErrorShape(candidate)) {
    return null;
  }
  return CONFLICT_CODES.has(candidate.code) ? "conflict" : "unavailable";
}
