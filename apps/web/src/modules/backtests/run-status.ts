// Drizzle-free run-status vocabulary. `strings.ts` is reachable from
// `client.ts` ("use client" components, ARCHITECTURE.md), and must never
// pull Drizzle, the schema or UserScopedRepository into a client bundle;
// `backtest-run-repository.ts` needs the same discard reason and active-
// status set. Both import it from here instead of one importing the other.

export const DISCARDED_RUN_ERROR = "discarded";

export const ACTIVE_RUN_STATUSES = ["pending", "running", "paused"] as const;
export type ActiveRunStatus = (typeof ACTIVE_RUN_STATUSES)[number];

export function isActiveRun<T extends { status: string }>(
  run: T,
): run is T & { status: ActiveRunStatus } {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status);
}

// A discarded run is a `failed` row carrying the fixed DISCARDED_RUN_ERROR
// reason (ADR-0037): shape callers (pages, claim(), guardedUpdate) check
// instead of re-deriving `status === "failed" && error === "discarded"`
// inline at each call site.
export function isDiscardedRun(run: { status: string; error: string | null }): boolean {
  return run.status === "failed" && run.error === DISCARDED_RUN_ERROR;
}
