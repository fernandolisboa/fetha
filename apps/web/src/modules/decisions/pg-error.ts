// A decisions-local equivalent of strategies/pg-error.ts (kept module-private
// there, so not importable across the boundary): same shape, tuned to what
// `DecisionsRepository.record` needs to distinguish — the unique violation on
// (user_id, signal_id) (a signal is answered once) from the horizon check
// constraint (defense in depth behind the action's own pre-insert validation,
// see actions.ts) from every other conflict or transient failure.
interface PgDriverError {
  code: string;
  severity: string;
}

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

const OTHER_CONFLICT_CODES = new Set(["40001", "40P01"]);

export type DecisionPersistenceOutcome =
  "duplicate_signal" | "invalid_horizon" | "conflict" | "unavailable" | null;

export function classifyDecisionPersistenceError(error: unknown): DecisionPersistenceOutcome {
  const candidate = error instanceof Error && "cause" in error ? error.cause : error;
  if (!isPgDriverErrorShape(candidate)) {
    return null;
  }
  if (candidate.code === "23505") {
    return "duplicate_signal";
  }
  if (candidate.code === "23514") {
    return "invalid_horizon";
  }
  if (OTHER_CONFLICT_CODES.has(candidate.code)) {
    return "conflict";
  }
  return "unavailable";
}
