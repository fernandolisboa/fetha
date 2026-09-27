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
- Because `COUNTS_AS_ACTIVE.failed === false`, a discarded run stops counting toward the cap the
  moment it is discarded — no separate bookkeeping.
- A discarded run must never come back into the active set:
  - `claim()`'s reclaim-from-`failed` branch now excludes rows whose `error` is
    `DISCARDED_RUN_ERROR`, so a "Continuar"/retry click (or a direct call) cannot resume a run the
    user explicitly discarded, the way it can resume one that failed for a transient reason
    (round 2 item 12 of #147's own history).
  - `run-chunk.ts` never re-checks status between claiming a run and persisting a checkpoint,
    completion or failure for it, so a chunk already in flight when a discard lands would otherwise
    write a `saveProgress`/`complete` straight past the discard. `guardedUpdate` (the single path
    `saveCheckpoint`, `saveProgress`, `complete` and `fail` all share) now also refuses a row that
    has been discarded, both in a pre-check and in the write's own `WHERE` clause, raising the same
    `BacktestRunClaimError` a lost claim already raises rather than reviving the run.
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

## Consequences

- A run's `error` column now carries one non-engine, non-web-layer value a UI must special-case:
  callers that already switch on `error` for display (report page, `runErrorMessage`) gained one
  more branch instead of a new column.
- `guardedUpdate`'s optimistic-concurrency check widened from "not complete" to "not complete and
  not discarded"; every other conditional update it guards (a run in `pending`, `paused` or
  `running`) is unaffected.
- Discarding does not clear a run's stored `checkpoint` or `result`; there is still no way to purge
  storage for an old run, discarded or not (ADR-0032's own consequence, unchanged).
