---
status: accepted
date: 2026-09-27
---

# Discarding a stuck backtest run, and listing runs in progress across strategies (amends 0032)

## Context

ADR-0032 capped a user at `MAX_ACTIVE_BACKTEST_RUNS = 2` runs in `pending`, `running` or `paused`,
but named two residuals it left open (#159): nothing discards a run, so a user at the cap has to
finish one to free a slot; and runs were listed per strategy only, so a user refused with "Você já
tem dois backtests em andamento" had to hunt through strategies to find the one to free.

## Decision

- A user can discard any of their own runs in `pending`, `running` or `paused`
  (`BacktestRunRepository.discard`). The run moves to `failed` with a fixed reason stored in the
  existing `error` column (`DISCARDED_RUN_ERROR = "discarded"`) — no migration. Terminal runs
  (`complete`, `failed`, including an already-discarded one) answer the typed
  `{ status: "not_discardable" }` result rather than throwing; a run not owned by the caller throws
  `BacktestRunNotFoundError` from the same `findMine` isolation check every other per-id method
  uses.
- `DISCARDED_RUN_ERROR` and the active-status tuple (`ACTIVE_RUN_STATUSES = ["pending", "running",
"paused"]`) live in a new, Drizzle-free `modules/backtests/run-status.ts`, imported by both
  `backtest-run-repository.ts` and `strings.ts`: `strings.ts` is reachable from `client.ts` ("use
  client" components), which must never pull Drizzle, the schema or `UserScopedRepository` into a
  client bundle (ARCHITECTURE.md). `isDiscardedRun`/`isActiveRun`, exported from the module index,
  are what pages check instead of re-deriving `status`/`error` comparisons inline; `DISCARDED_RUN_ERROR`
  itself stays internal to the module.
- Because a `failed` row is outside `ACTIVE_RUN_STATUSES`, a discarded run stops counting toward the
  cap the moment it is discarded — no separate bookkeeping.
- A discarded run must never come back into the active set:
  - `claim()`'s reclaim-from-`failed` branch now excludes rows whose `error` is
    `DISCARDED_RUN_ERROR`, so a "Continuar"/retry click (or a direct call) cannot resume a run the
    user explicitly discarded, the way it can resume one that failed for a transient reason
    (round 2 item 12 of #147's own history). `claim()` checks this _before_ `enforceActiveCap`, not
    after: a discarded row no longer counts toward the cap, so checking the cap first could answer
    `ActiveBacktestRunLimitError` for a claim that was always going to be refused for the real
    reason, `BacktestRunClaimError`.
  - `run-chunk.ts` re-reads the run once more, right after `loadMarketView` and before the first
    `engine.runBacktest` call, and aborts with `BacktestRunClaimError` if it was discarded in that
    window — the widest gap between the chunk's own claim and its first write (`loadMarketView`
    alone measured ~23.5s at the universe/session ceiling, round 3 item 4). This re-check calls a
    new `statusOf(id)`, not `findMine`: the hot-path check only needs `status` and `error`, not
    every column `findMine`'s own `toRecord` re-parses through Zod (checkpoint, result, structure,
    universe...). `guardedUpdate` (the
    single path `saveCheckpoint`, `saveProgress`, `complete` and `fail` all share) is still the
    backstop that closes the race for good, both in a pre-check and in the write's own `WHERE`
    clause, raising the same `BacktestRunClaimError` a lost claim already raises — the re-check in
    `run-chunk.ts` only means an already-discarded run's engine step is never paid for, not just
    never persisted.
  - Both `claimRow`'s and `guardedUpdate`'s `WHERE` clauses compare `error` with `IS DISTINCT FROM`,
    not `<>`/`!=`: a `failed` row with a `NULL` error (never written today, but not schema-impossible)
    must stay writable and claimable, and a plain `<>` against `NULL` evaluates to `NULL`, which
    Postgres excludes from `WHERE` as if the row really were discarded.
- The report page renders a discarded run distinctly (no "A simulação falhou" framing) and offers
  no retry; `runErrorMessage("discarded")` returns the pt-BR label "Descartado" instead of the raw
  code, the same split every other run error already gets.
- A new "Em andamento" panel on `/estrategias` (`getMyActiveBacktestRuns`,
  `BacktestRunRepository.listMineActive`) lists every run still holding an active-cap slot across
  strategies, each linking to its run page and carrying its own discard control. The
  "Você já tem dois backtests em andamento" refusal now links there
  (`IN_PROGRESS_RUNS_HREF = "/estrategias#em-andamento"`).
- No advisory lock is taken for `discard`: it is a single conditional `UPDATE` scoped by
  `id`, `user_id` and `status IN (...)`, the same shape `claimRow` already uses without the lock.
  The per-user `pg_advisory_xact_lock` ADR-0032 introduced exists to make a _count-then-insert_
  atomic across concurrent creates; discarding never counts anything, so there is nothing for the
  lock to protect.
- The discard action carries its own per-account rate-limit bucket (`"backtests/discard"`, 10 per
  60 seconds, mirroring `createBacktestRunAction`'s own `CREATE_RATE_LIMIT`): cheap as one
  conditional `UPDATE` is, an unbounded loop of it is still an unbounded write loop.

## Consequences

- A run's `error` column now carries one non-engine, non-web-layer value a UI must special-case:
  callers that already switch on `error` for display (report page, `runErrorMessage`) gained one
  more branch instead of a new column.
- `guardedUpdate`'s optimistic-concurrency check widened from "not complete" to "not complete and
  not discarded"; every other conditional update it guards (a run in `pending`, `paused` or
  `running`) is unaffected.
- Discarding does not clear a run's stored `checkpoint` or `result`; there is still no way to purge
  storage for an old run, discarded or not (ADR-0032's own consequence, unchanged).
- ADR-0032's "at most two busy functions per user" is approximate for the window between a discard
  landing on a `running` run and that run's own in-flight `runBacktestChunk` invocation reaching
  its post-load re-check: the invocation keeps paying for whatever `MarketView` load it already
  started (or the inner `engine.runBacktest` step it is mid-way through, if the discard lands after
  the re-check but before that step returns) before it stops. The cap bounds how many runs a user
  can hold open, not how many chunk invocations can be transiently busy at once; this was already
  true of a stale-lease reclaim racing a still-alive chunk before this ADR.
