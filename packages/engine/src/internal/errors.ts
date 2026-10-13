import type { EngineError, Result } from "../api";

// Shared by every module that builds a plain `invalid_input` EngineError from a path and a
// message: price-operation.ts, mark-to-market.ts, propose-settlement.ts,
// operation-coherence.ts and validate-view-integrity.ts had each declared their own copy.
export function invalidInput(path: string, message: string): EngineError {
  return { code: "invalid_input", path, message };
}

// The failing side of a `Result`, shared by every engine method that returns one.
export function err<T>(error: EngineError): Result<T> {
  return { ok: false, error };
}
