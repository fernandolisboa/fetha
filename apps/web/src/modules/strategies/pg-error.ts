import { postgresErrorOf } from "@/db/pg-error";

const CONFLICT_CODES = new Set(["23505", "40001", "40P01"]);

export type PersistenceErrorOutcome = "conflict" | "unavailable" | null;

// Anything that is not recognizably a Postgres error (a bug, an out-of-memory
// error, a programming mistake) is not this function's to classify — the
// caller rethrows it rather than reporting a misleading "unavailable".
export function classifyPersistenceError(error: unknown): PersistenceErrorOutcome {
  const candidate = postgresErrorOf(error);
  if (!candidate) {
    return null;
  }
  return CONFLICT_CODES.has(candidate.code) ? "conflict" : "unavailable";
}
