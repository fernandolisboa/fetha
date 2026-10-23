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

Two data classes were open in market-data at the same time: dividend yields and the IV index.
Dividend yields need a per-stock licensed source; no free one exists and no ADR decides one yet
(ADR-0052 covers corporate-action split and bonus factors only, a different gap). Unlike dividend
yields, the IV index needs no new provider: it is computed entirely from COTAHIST option day
prices, the B3 instruments registry (series, strikes, expiries) and Bacen SGS (CDI, the risk-free
proxy) — every one of them already ingested daily. This ADR is scoped to the IV index alone.

## Decision

A new session-bound ingestion source, `iv_index`, runs after `cotahist`, `instruments` and `sgs`
in `ingest()`. For each session it drains:

1. **Eligibility.** A session is only attempted once `cotahist` and `instruments` both have a
   succeeded run for it (the compute step needs that session's own option chain and series
   registry), and a CDI macro point is visible at the session's own close and dated on or after
   the previous trading session (`cdiEligibility`, `iv-index-compute.ts`): without a fresh
   rate, the engine's own risk-free resolution would default `r = 0` silently and bake the wrong
   rate into a point that is never recomputed once persisted. An ineligible session answers
   `{ rowCount: 0, pending: true }` — the same shape `sgs` already uses for a not-yet-published CDI
   (ADR-0017, #216) — so no succeeded marker is written and the session keeps retrying on later
   runs instead of aging into a permanent gap. The one exception is the first session of the
   history, which is terminal (Follow-ups below).
2. **Compute, one underlying at a time, resumable.** `underlyingsToComputeForSession` (a new
   `iv-index-repository.ts`) lists every underlying with both an `option_daily_prices` row and its
   own stock candle on that session — the minimum a spot and a chain give the engine to solve for.
   `underlyingsWithPointOnSession` narrows that list to the ones still missing a point, so a call
   that starts after an earlier one was cut short by the hard stop (below) only recomputes what is
   left, never redoing an underlying already written this session. For each remaining underlying
   (view assembly superseded by the #334 addendum below),
   `buildOperationMarketView(db, underlying, sessionClose)` builds the same shape of view
   `priceOperation` uses, but the option prices it carries are filtered down to rows stamped for
   `session` itself before the engine ever sees them: `buildOperationMarketView`'s own
   `latestOptionPricesAt` looks back roughly 30 sessions for a bracket's latest trade, which would
   otherwise let a stale premium from days earlier price a point stamped for today's close. A
   bracket leg with no trade on `session` is treated as unpriced, exactly like a bracket that never
   existed. `engine.impliedVolatilityIndex({ view, underlying, at: sessionClose })` then computes
   the point.
3. **asOf is the session's own close**, the exact instant `ingest.ts` already stamps that
   session's candles with (`trading.close`), never the time the job happened to run — the rule
   ADR-0051 requires so a one-night view and a backtest's view agree on which session a point
   belongs to.
4. **A null result is skipped, not a session failure**: a chain that fails to bracket 30 calendar
   days (`iv_index_not_bracketed`, an engine `Result` with `ok: true` and a `null` value) is a
   legitimate outcome for a thinly-listed underlying. That underlying stays without a point for
   this session permanently — once the session itself later succeeds, a skipped underlying is not
   retried; only a session that is itself `pending` or was left partially computed (below) is
   resumed. An `ok: false` engine result, or a `MarketViewUnavailableError`/
   `MarketViewTooLargeError` for one underlying, instead leaves the whole session `pending`: what
   was computed for other underlyings is still upserted, but no succeeded marker is written, so the
   session is retried and that underlying gets another chance. Any other error — a database
   failure, a bug — is left to propagate out of `computeIvIndexForSession`: `runSource` marks the
   whole session `failed` and it is retried on the next run, rather than this step silently
   reporting "0 rows, succeeded" for a systematic failure that a `succeeded` marker would then hide
   from every later run.
5. **A hard stop inside a session.** `computeIvIndexForSession` takes an optional deadline, checked
   between underlyings; once passed, the loop stops, upserts whatever it already computed and
   reports `{ pending: true }` instead of finishing the session. `ingest()` sets this deadline to
   60% of `maxDurationMs` past its own start (`IV_INDEX_HARD_STOP_FRACTION`), so one session's own
   compute can never run past that point even if it started earlier under budget.
6. **One point per `(underlying, session)`**, upserted (`implied_volatility_index`): the same point
   shape `MarketView.impliedVolatilityIndex` carries (`underlying`, `session`, `asOf`,
   `impliedVolatility`), plus `method` and a write-time `computed_at` (below) that are not part of
   that engine shape.

**Backfill, budgeted alongside the recent window, not separately.** `iv_index` did not exist
before this ticket, so every session where both `cotahist` and `instruments` have ever succeeded
is a gap the moment this source ships. `succeededSessionsMissingRun(db, ["cotahist",
"instruments"], "iv_index")` anti-joins against both required sources, not `cotahist` alone, since
eligibility itself needs both. `ingest()` builds one priority-ordered session list per run: the
newest session of the normal recent window (`gaps(db, "iv_index", now)`) is handled on its own,
since it is the one session tonight's evaluation reads; every older recent-window session, reversed
to newest first, is concatenated with the backfill batch (already newest first) and deduplicated.
`runNightlyJob` shares one 300s route across `ingest()`, signal evaluation and scoring
(`run-nightly-job.ts`); evaluation and scoring are already deadline-aware, but `ingest()` itself is
not, and a first production night can open with all ten recent-window sessions as gaps, each
computing every optionable underlying. Left unbudgeted, that recent window alone could exhaust the
route's own budget and starve evaluation and scoring. `runSessionBoundSource` (`ingest.ts`)
therefore stops _starting_ a new session, for a given list, once `Date.now()` reaches a deadline
parameter passed in (default `Infinity` for every other source, which never budgets): the older
recent sessions and the backfill batch stop starting at `IV_INDEX_START_BUDGET_FRACTION` (40%) of
`maxDurationMs` past `ingest()`'s own start, while the single newest recent-window session is
allowed to start as late as the 60% hard stop itself, since a fresh point for it matters more than
finishing the backfill batch. A session the relevant deadline stops before it starts is left alone
entirely: not attempted, not recorded as failed or skipped, counted instead as `deferred` on the
source's own `SourceOutcome`, which also marks it `pending` — a source starved by its own budget
must never report `skipped`, the vocabulary reserved for "caught up" (ADR-0017). The full history
fills in over successive nightly runs with no manual script; `ivIndexBudgetMs` on `IngestOptions`
overrides the computed start budget for tests that need it already elapsed without touching
`maxDurationMs`, which every other source's `reapStaleRunningRuns` cutoff also depends on in the
same invocation.

**iv_index errors stay out of `ingest()`'s own `ok`.** `iv_index` is computed reference data
derived from sources `ingest()` already reports on their own terms; like `cotahistSucceeded`
already does for `sgs`/`instruments` failures in `run-nightly-job.ts`, an `iv_index` error is still
carried on its own `SourceOutcome` (and can still fail the whole run if it is the only source that
matters to a caller checking sources directly), but it is excluded from the boolean `ingest()`
returns as `ok`, so the nightly cron route never turns a 500 on account of `iv_index` alone.

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
the window's own instruments and `[fromSession, toSession]`. `dataVersion` folds in each row's
`computed_at`, not its `asOf`: `asOf` is the session's own close, which a backfilled point can share
with a candle this window already loaded, so `asOf` alone could never tell a resumed backtest chunk
that new IV data landed inside a window it already read. `computed_at` is the write-time stamp that
does move: the insert defaults it to `now()` and the upsert's `onConflictDoUpdate` also sets it to
`now()`, so any write — first or backfilled, resumed or replacing a value — bumps it.

**Follow-ups (#264).**

- **The first session of the history is terminal, not pending forever.** CDI is ingested from the
  calendar's own first day (`SGS_DEFAULT_SINCE`) and each point is visible only from the next
  session's open, so a session with no earlier trading session can never see a rate at its close.
  `computeIvIndexForSession` settles it with no point and no `pending` (a `succeeded` run with 0
  rows) instead of retrying it every night; this is the one exception to ADR-0051's rule that every
  session gets a point. It is never computed with `r = 0`: the rule above still
  holds for every session that could one day see a rate. "No earlier session" reads the
  `trading_sessions` rows, not `FIRST_INGESTED_CALENDAR_YEAR`; lowering that constant does not
  reopen the settled session, and needs none: SGS only moves forward from its latest point, so no
  earlier CDI would ever land for it.
- **The nightly report carries what `pending` hides.** The `iv_index` `SourceOutcome` reports its
  `deferred` count and `newestSessionComputed`: whether the session tonight's evaluation reads
  (`IngestOutcome.session`) has a succeeded `iv_index` run. Both reach the stored report
  (ADR-0045). While the backfill drains, `pending` stays constant, so these two are what tell a
  draining backfill apart from an evaluated session left without its index.
- **The owner's manual trigger logs an `iv_index` failure** (kept out of `ok`) and an evaluated
  session left without its index, like every other trouble that does not flip `ok`. A backfill
  that only defers older sessions is not logged: it defers sessions every night until it drains.

## Consequences

- `iv_rank`-reading strategies are backtestable and nightly-evaluatable from this ticket on,
  subject to ADR-0051's strict-window rule: an underlying needs `lookbackSessions` consecutive
  sessions of IV points, in range, before a rank reads a number.
- The backfill is best-effort and gradual: a strategy created the day this ships can wait several
  nights before a long `iv_rank(252)` window is fully covered for a given underlying. This is the
  same shape ADR-0051 already accepted for a missing session; it is not a regression this ticket
  introduces.
- Dividend yields remain unimplemented; `q = 0` and `dividend_yield_defaulted` are still what the
  IV index (and every other pricing path) uses until a dividend-yield source is decided (no ADR
  covers it yet).
- The nightly evaluation consumes a session whether or not `iv_index` covered it: an `iv_rank`
  condition on a session the budget deferred records `insufficient_data` and is not re-evaluated
  on its own once the backfill fills it (re-evaluation stays a user action, ADR-0047).
- `computed_at` is a wall clock, so an `iv_rank` backtest resumed after a nightly run that wrote
  points inside its window fails with `data_version_changed` rather than mixing datasets; while
  the backfill drains, long `iv_rank` runs are effectively single-sitting.
- `implied_volatility_index` is shared reference data (CLAUDE.md principle 5): no `user_id`, no
  isolation test, read-only to every user, written only by this ingestion source.
- Known limitation: the engine's `impliedVolatilityIndex` result carries `seriesUsed` (which two
  expiries bracketed 30 days) and a `notes` array (e.g. `dividend_yield_defaulted`); neither is
  persisted. A later ticket that needs to show which series a stored point came from, or surface
  the notes that applied when it was computed, has to recompute rather than read them back.

## Addendum: `sgs` has a start deadline too (2026-10-13, #298)

The deadline parameter of `runSessionBoundSource` is no longer `Infinity` for every source but
`iv_index`: `sgs` uses the same 40% start budget for its older gaps and this ADR's 60% hard stop
for its newest session, since that session's CDI is what tonight's IV index needs (ADR-0017
addendum).

## Addendum: `cvm_filings` runs between the newest session and the backfill (2026-10-13, #309)

After tonight's iv_index session and before the backfill, `ingest()` now reads the CVM filings
(ADR-0060) under a 70% start budget, past the newest session's 60% hard stop, so it never delays
the session tonight's evaluation reads and can only shorten the backfill's own budget.

## Addendum: `iv_index` waits for `indexes` on the sessions it is responsible for (2026-10-13, #307, ADR-0062)

A new source, `indexes`, writes `IBOV11`'s daily close into `candles` (ADR-0062), running after
`instruments` and before `sgs`. A session `indexes` attempted this run and did not succeed on
(`indexesSessions.filter(session => !indexesResult.okSessions.includes(session))`) leaves
`iv_index` `pending` for it, checked next to the `cotahist`/`instruments` succeeded-run gate: the
same shape the CDI gate above already has. Without this, a late B3 index document would silently
drop `IBOV11`'s point for that session the moment it enters `underlyingsToComputeForSession`,
rather than waiting one more cron for it. Sessions `indexes` never attempted this run (the
backfill batch, outside its own recent window) are unaffected and keep draining on their own
schedule. The cost is the same shape as the existing CDI gate: while B3's index file lags past a
cron, every underlying's IV point for that session waits for the next one, not only `IBOV11`'s.

## Addendum: each underlying reads only the chain the 30-day bracket can use (2026-10-21, #334)

Each underlying's view used to re-read the session's calendar twice (the past window and the
forward leg through its own furthest expiry, LEAPS included), its whole option chain, and every
option's latest price over the trailing window, only to keep one number. `computeIvIndexForSession`
now loads the calendar once per session (`loadIvIndexSessionCalendar`, the past window plus every
future session) and builds each view with `buildIvIndexMarketView`, which:

1. slices that calendar exactly as `calendarWindowThroughExpiry` would have answered;
2. reads the chain only for the tickers with a visible row expiring on or before the first expiry
   past the target session (the first session on or after 30 calendar days from the session `at`
   falls in, ADR-0013's `atm_30d_variance_interpolated`), each ticker with every one of its own
   rows, so a ticker B3 reused for a later cycle (ADR-0017) still collapses to the epoch the full
   read would pick;
3. keeps that narrowed chain only when one of its collapsed series still lists that first expiry
   and it is a calendar session: every expiry on or before it is then read in full, so the lower
   leg, the upper leg and an exact-tenor expiry are the full read's own. Otherwise (the first
   expiry survives only on an older cycle of a reused ticker, it is not a session, or there is
   none) it falls back to the full chain;
4. reads option prices from the session itself only, the one the compute step keeps anyway.

The engine and its frozen interface are unchanged; the point is the same value the full view
produces (integration tests compare both, including the reused-ticker and no-upper-expiry
fallbacks). The target rule in step 2 mirrors the engine's `CALENDAR_DAYS_TO_TARGET`
(`ivIndexTargetSession`, market-view.ts): a change to the engine's tenor must change both, since
the fallback does not cover a different target (a mismatch would drop points, not alter them).
Measured by the Postgres container's `tx_bytes` around one `computeIvIndexForSession` call on the
e2e recorded sessions (PETR4 chain only): 662 → 253 KiB on 2026-09-08 and 760 → 355 KiB on
2026-09-18, identical stored points; more once the shared calendar spans ~175 underlyings.

## Addendum: points computed before point-in-time strikes are recomputed in place (2026-10-22, #275)

This amends rule 1's "never recomputed once persisted" and rule 2's narrowing: a point marked
`stale` is recomputed, and `ivIndexPointStatesOnSession` (formerly
`underlyingsWithPointOnSession`) counts only non-stale points as done.

Points computed before ENGINE_VERSION 0.9.0 reached production (#270, PR #277, deployed
2026-10-01 07:50Z) resolved strikes without the engine's adjusted-strike resolution (and, for most
of them, before ADR-0056's epochs landed with PR #268 at 01:38Z that day). That covers a split and
every cash-dividend re-strike, so this set is "computed too early", not "has a split". Separately,
#272 (PR #347, ADR-0056 addendum) re-dated early backfilled epochs, so a point computed after
that deploy can still have read a post-event strike before its ex-date; it only happens for an
underlying with a recorded corporate action factor. The owner approved overwriting both sets on
2026-10-22: they are derived data, recomputable from stored option prices, and no user-entered
row depends on them.

- **`implied_volatility_index.stale`** (boolean, default false). Migration 0046 sets it on every
  point with `computed_at < 2026-10-01T09:00:00Z` (the first nightly cron after that deploy; a
  point computed between the deploy and the cron is recomputed needlessly, never missed) and on
  every point of an underlying with a `corporate_action_factors` row. Recomputing a point that was
  already right only rewrites the same value.
- **Recording a factor marks the ticker's points stale.** `recordCorporateActionFactorAction`
  sets the flag on every point of that ticker when the factor or the strike epoch bounds change,
  in the same transaction: either change moves the strike a stored point resolved, for sessions
  before and after the ex-date. An identical resubmission marks nothing.
- **Reopened by the nightly run, not by the migration.** Each nightly run (not a single-session
  run) first deletes the `succeeded` `iv_index` run of every session holding a stale point, so
  those sessions re-enter the backfill list (`succeededSessionsMissingRun`, newest first) under
  the existing 40%/60% budget. No new scheduling. Doing it in the migration would race the
  previous deployment: code that predates the flag counts a stale point as done and would mark
  the session succeeded again without recomputing it. A session drops out once it has no stale
  point left.
- **In place, never deleted first.** `computeIvIndexForSession` treats a stale point as not done,
  recomputes it and upserts over it (`stale = false`, `computed_at = now()`). A stale point keeps
  serving `iv_rank`, the radar and the suggestions until then, so no window loses a session while
  the recompute drains; until it does, a window can mix recomputed and stale points, and nothing
  flags a reading taken in that time. A stale point the current rules no longer produce (the
  engine now returns no value, or the underlying no longer qualifies) is deleted only when the
  session completes; a pending session (including one whose recompute keeps failing) keeps it and
  retries the next night. Recompute covers existing points only: an underlying with no point on a
  session is filled as before, by the session's own backfill.
- **Cost.** A reopened session recomputes only its stale underlyings and reads what the original
  backfill read for them, within the same nightly start budget, so a night's database traffic
  stays within a normal backfill night; the drain takes as many nights as the budget needs. The
  size of the set in production (sessions before 2026-10-01 plus the history of each underlying
  with a recorded factor) was not measured from here.
- **Side effect.** `computed_at` feeds `dataVersion`, so a chunked `iv_rank` backtest resumed while
  its window is being recomputed fails with `data_version_changed` once, as during the original
  backfill; rerunning it fixes it. Stored backtest runs, analyses and signals are not rewritten.
- The flag is generic: a later rule change that alters stored points can mark its own set stale
  and reuse this path.

## Addendum: dividend yields come from strike adjustments; the IV index stays on `q = 0` (2026-10-23, #81, ADR-0070)

The Context's "dividend yields need a per-stock licensed source" no longer holds: ADR-0070 reads
cash distributions off the uniform strike drops B3 applies to every listed option on the ex-date,
from COTAHIST, and derives each view's trailing yield from them. `buildIvIndexMarketView` does not
load those yields, so every stored and future IV point stays on `q = 0` and an `iv_rank` window
never mixes the two bases. Moving the index to `q > 0` is a separate change: mark every point
stale and let the #275 path recompute it.
