---
status: accepted
date: 2026-09-29
---

# The IV index is computed nightly from already-ingested option prices, no new source (#81)

## Context

ADR-0013 defines `impliedVolatilityIndex` (`atm_30d_variance_interpolated`): bracket the
30-calendar-day point between the two nearest listed expiries and interpolate linearly in total
variance, the standard construction for a fixed-tenor volatility index. ADR-0051 makes `iv_rank`
read that index strictly, over a complete window of sessions, and calls out that no pipeline wrote
it yet: `market-view.ts`'s loader refused every strategy that read `iv_rank` at all
(`canSatisfyCollection`), so the nightly run and a backtest create both hard-refused it with
`unsatisfiable_collection` rather than ever reaching the engine.

Two data classes were open in market-data at the same time: dividend yields (a per-stock number
with no free source, ADR-0052 still weighs a paid one) and the IV index. Unlike dividend yields,
the IV index needs no new provider: it is computed entirely from COTAHIST option day prices, the
B3 instruments registry (series, strikes, expiries) and Bacen SGS (CDI, the risk-free proxy) —
every one of them already ingested daily. Dividend yields stay deferred to ADR-0052's source
decision; this ADR is scoped to the IV index alone.

## Decision

A new session-bound ingestion source, `iv_index`, runs after `cotahist`, `instruments` and `sgs`
in `ingest()`. For each session it drains:

1. **Eligibility.** A session is only attempted once `cotahist` and `instruments` both have a
   succeeded run for it (the compute step needs that session's own option chain and series
   registry). An ineligible session answers `{ rowCount: 0, pending: true }` — the same shape
   `sgs` already uses for a not-yet-published CDI (ADR-0017, #216) — so no succeeded marker is
   written and the session keeps retrying on later runs instead of aging into a permanent gap.
2. **Compute, one underlying at a time.** `underlyingsToComputeForSession` (a new
   `iv-index-repository.ts`) lists every underlying with both an `option_daily_prices` row and its
   own stock candle on that session — the minimum a spot and a chain give the engine to solve for.
   For each, `buildOperationMarketView(db, underlying, sessionClose)` builds the same shape of view
   `priceOperation` uses, and `engine.impliedVolatilityIndex({ view, underlying, at: sessionClose })`
   computes the point.
3. **asOf is the session's own close**, the exact instant `ingest.ts` already stamps that
   session's candles with (`trading.close`), never the time the job happened to run — the rule
   ADR-0051 requires so a one-night view and a backtest's view agree on which session a point
   belongs to.
4. **A null result, or a `MarketViewUnavailableError`/`MarketViewTooLargeError` for one
   underlying, is skipped**, not a session failure: a chain that fails to bracket 30 calendar days
   (`iv_index_not_bracketed`, an engine `Result` with `ok: false`) is a legitimate outcome for a
   thinly-listed underlying, and `buildOperationMarketView`'s own "unavailable" errors are the
   same kind of legitimate gap `loadMarketView`'s callers already treat as non-fatal elsewhere in
   this module. One underlying's failure must never cost every other underlying's point for the
   night. The skipped underlying stays without a point for that session, exactly the gap ADR-0051
   already tolerates and the backfill below closes over time. Any other error — a database
   failure, a bug — is left to propagate out of `computeIvIndexForSession`: `runSource` marks the
   whole session `failed` and it is retried on the next run, rather than this step silently
   reporting "0 rows, succeeded" for a systematic failure that a `succeeded` marker would then
   hide from every later run.
5. **One point per `(underlying, session)`**, upserted (`implied_volatility_index`, ADR-0013's
   shape: `underlying`, `session`, `asOf`, `impliedVolatility`, `method`).

**Backfill, budgeted alongside the recent window, not separately.** `iv_index` did not exist
before this ticket, so every session `cotahist` has ever succeeded on is a gap the moment this
source ships. `ingest()` builds one priority-ordered session list: the normal recent-window gaps
(`gaps(db, "iv_index", now)`, newest first) ahead of the backfill batch — sessions where `cotahist`
has succeeded but `iv_index` never has, also newest first — deduplicated. `runNightlyJob` shares one
300s route across `ingest()`, signal evaluation and scoring (`run-nightly-job.ts`); evaluation and
scoring are already deadline-aware, but `ingest()` itself is not, and a first production night can
open with all ten recent-window sessions as gaps, each computing every optionable underlying. Left
unbudgeted, that recent window alone could exhaust the route's own budget and starve evaluation and
scoring. `ingest()` therefore stops _starting_ a new `iv_index` session, recent or backfill alike,
once `Date.now()` reaches `IV_INDEX_BUDGET_FRACTION` (40%) of `maxDurationMs` past its own start —
leaving the rest of the budget for whichever session is already in flight, plus evaluation and
scoring. A session the deadline stops before it starts is left alone entirely: not attempted, not
recorded as failed, so it stays a gap the next run picks up. The full history fills in over
successive nightly runs with no manual script; `ivIndexBudgetMs` on `IngestOptions` overrides the
computed budget for tests that need the deadline already elapsed without touching `maxDurationMs`,
which every other source's `reapStaleRunningRuns` cutoff also depends on in the same invocation.

**The `unsatisfiable_collection` refusal is removed.** `market-view.ts`'s `canSatisfyCollection`
and `UNSATISFIABLE_COLLECTIONS` are deleted along with every caller that asked them
(`backtests/actions.ts`, `strategies/evaluate-version.ts`, and the branch in
`strategies/evaluate-signals.ts` that only ever silenced that one reason from `errors`).
`impliedVolatilityIndex` is now a collection the loader can fill, like every other one. A strategy
reading `iv_rank` before its underlying has enough history simply reads `insufficient_data` (or
`null`, per ADR-0051) like any other indicator with too short a warm-up — no different in kind from
a fresh SMA. The web-authored `unsatisfiable_collection` reason code stays in
`evaluation-vocabulary.ts` and `strings.ts` only to render evaluation-log rows a nightly run already
persisted with it before this ticket; no live code path produces it anymore.

**The loader.** `loadMarketViewWithCalendarVersion` fills `impliedVolatilityIndex` from
`iv-index-repository.ts`'s `ivIndexPointsInRange` whenever the window asks for that collection, over
the window's own instruments and `[fromSession, toSession]`, and folds each point's own `asOf` into
`dataVersion` like every other collection.

## Consequences

- `iv_rank`-reading strategies are backtestable and nightly-evaluatable from this ticket on,
  subject to ADR-0051's strict-window rule: an underlying needs `lookbackSessions` consecutive
  sessions of IV points, in range, before a rank reads a number.
- The backfill is best-effort and gradual: a strategy created the day this ships can wait several
  nights before a long `iv_rank(252)` window is fully covered for a given underlying. This is the
  same shape ADR-0051 already accepted for a missing session; it is not a regression this ticket
  introduces.
- Dividend yields remain unimplemented; `q = 0` and `dividend_yield_defaulted` are still what the
  IV index (and every other pricing path) uses until ADR-0052 is resolved.
- `implied_volatility_index` is shared reference data (CLAUDE.md principle 5): no `user_id`, no
  isolation test, read-only to every user, written only by this ingestion source.
