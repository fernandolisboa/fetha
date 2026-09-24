// A decisions-local equivalent of strategies/pg-error.ts (kept module-private
// there, so not importable across the boundary): same shape, tuned to what
// `DecisionsRepository.record` needs to distinguish — the unique violation on
// (user_id, signal_id) (a signal is answered once) from *specifically* the
// horizon check constraint (defense in depth behind the action's own
// pre-insert validation, see actions.ts) from every other conflict or
// transient failure. Any other 23514 (a check constraint this module does
// not know how to explain to the user) falls through to the caller, which
// rethrows it rather than mislabeling it invalid_horizon.
interface PgDriverError {
  code: string;
  severity: string;
  constraint?: string;
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

const HORIZON_CHECK_CONSTRAINT = "decisions_horizon_on_or_after_decided_check";

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
    return candidate.constraint === HORIZON_CHECK_CONSTRAINT ? "invalid_horizon" : null;
  }
  if (OTHER_CONFLICT_CODES.has(candidate.code)) {
    return "conflict";
  }
  return "unavailable";
}
