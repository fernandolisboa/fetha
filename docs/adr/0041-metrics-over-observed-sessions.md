---
status: accepted
date: 2026-09-27
---

# Backtest metrics are computed over observed sessions only; the warm-up prefix is excluded (amends 0013)

## Context

#92 found two ways a backtest run's `metrics.sessions` counts a period session that could never
have traded, diluting every ratio ADR-0013 "Equity and metrics" derives from it:

1. `runBacktest`'s `periodSessions` is every calendar session between `config.period.from` and
   `config.period.to` (a `MIN()`/`MAX()` union of ingested candle dates across the whole universe,
   `apps/web`'s `candleSessionBoundsInRange`). A session inside that range with no candle for any
   universe ticker still gets an `EquityPoint` — flat at the last known mark, since a stock leg's
   mark carries forward through `lastKnownClose` — and that flat point still counts toward
   `sessions`, with no note distinguishing it from a session the strategy actually saw, understating
   `exposure` whenever the gap falls inside a held period. `cagr`'s own clock must _not_ be fixed
   the same way, though: calendar time — and cash movement, e.g. a month-end tax deduction — is real
   across a candle-less gap even though the strategy could not observe it, so dropping the gap from
   `cagr`'s exponent would overstate the annualized return. A position held through a 60-session
   interior gap over what is otherwise a 500-session post-warm-up span, ending at +30% total return,
   must read `cagr = 1.3^(252/500) − 1 ≈ 14.14%`, using every post-warm-up session including the
   gap; using only the 440 sessions that actually carried a candle would overstate it to `1.3^(252
/440) − 1 ≈ 16.21%`.
2. The leading run of period sessions before a strategy's own indicators have enough history (`length`
   candles for `sma`, `3 × length` for the recursive `ema`/`rsi`/`atr` warm-up multiplier,
   `data-window.ts`'s `RECURSIVE_WARMUP_MULTIPLIER`) evaluates `insufficient_data` on every
   instrument, fires no signal, and is structurally dead: `evaluateStrategy` could not have traded
   it no matter what the data said. It still counts in `sessions`, understating `exposure` (it is
   never held) and diluting `cagr`'s exponent (`252 / sessions`) the same way a gap does.

Both dilutions are silent today: nothing in `BacktestRun` distinguishes a session the strategy
actually had a chance to trade from one it structurally could not, so a user reading `cagr` or
`exposure` has no way to tell "the strategy underperformed" from "the run's own denominator is
wrong".

## Decision

**Two domains, not one.** A session is _observed_ when it carries at least one universe candle and
is not in the strategy's own leading warm-up prefix; it is _post-warm-up_ when it is simply not in
that prefix, gaps included. `computeBacktestMetrics` (`packages/engine/src/internal/
backtest-metrics.ts`) gains two required, equal-length fields on `MetricsInput`, both parallel to
`equityCurve`: `observed: readonly boolean[]` and `postWarmup: readonly boolean[]` (`postWarmup` is
true wherever `observed` is true, plus every candle-less gap; both are false only inside warm-up).
Each metric reads whichever domain matches what it measures:

- **`sessions`, `sharpe`, `exposure`, and the `MIN_ANNUALIZED_SESSIONS` (126) threshold read the
  observed subsequence.** These ask "how many sessions did the strategy actually get a chance to
  act on", so a candle-less gap and the warm-up prefix are both excluded the same way: a run whose
  observed history is short is correctly flagged `short_window_not_annualized` even when its raw
  period is long, and `exposure`'s denominator never counts a session the strategy could not have
  held through in the first place.
- **`cagr`'s exponent, `maxDrawdown` and `totalReturn` read the post-warm-up subsequence, gaps
  included.** These ask "how much calendar time and real cash movement elapsed since the strategy
  could first trade": a gap's carried-forward mark is a real mark (nothing moved, but nothing was
  supposed to), and cash can move on an unobserved session (a month-end tax deduction settles on its
  own calendar date regardless of whether a candle exists), so both must see the whole post-warm-up
  curve. `cagr`'s base (`equityLast`) is always the post-warm-up curve's own final point, which is
  also the run's true final equity — warm-up is only ever a leading exclusion, so post-warm-up's
  last point never differs from the whole curve's.
- **Sharpe's own excess-return series stays observed-only** (a path statistic over what the
  strategy actually saw), but the risk-free comparison for an observed session's return must cover
  the same span the return itself does: a return computed against the previous _observed_ equity
  point implicitly spans every unobserved session in between, so the per-session rf of those dropped
  sessions is compounded forward into the next observed session's own rf, rather than compared only
  against that one session's single-day rate. A gap with a non-trivial rf but a flat (unmoved)
  equity mark now correctly reads as a negative excess return over the observed session that follows
  it, instead of a spurious zero-minus-rf term disappearing along with the dropped session.

`runBacktest` derives the two exclusions independently and combines them into `observed`:

- **`hasCandle`**, parallel to `equityCurve` (and checkpointed alongside it): true when
  `config.universe.some(ticker => candleFor(...) !== null)` at that session's close, computed at
  the same point `held` and `rfPerSession` already are (`recordEquityPoint`).
- **`firstTradableSession`**, a checkpointed scalar (`SessionDate | null`): the first period
  session at which `evaluateStrategy`'s own per-instrument evaluations were not _all_
  `insufficient_data`. It is found opportunistically off the same `evaluate()` call
  `queueNextSignals` already makes for every non-final session; the one session `queueNextSignals`
  never evaluates (the period's last, since there is no next session to fill an entry) gets one
  extra `evaluate()` call for this purpose alone, and only when `firstTradableSession` is still
  unknown by then — the common run never pays for it.

A session is in the warm-up prefix when `firstTradableSession` is `null` (the strategy never left
warm-up for the whole run) or the session's own date is before it; that decides `observed`
regardless of `hasCandle` for a warm-up session, so a leading session that happens to also lack a
candle is counted once, under warm-up, never doubled into both exclusions. `runBacktest` emits at
most two new notes on the completed run, mirroring the four existing run-level codes
(`negative_cash`, `limit_breach_warned`, `non_positive_equity`,
`option_strike_unadjusted_across_corporate_action` — repurposed by #69 part 2 (ADR-0013 `0.8.0`
addendum) to mean "this strike may not reflect a corporate action"; still emitted):

- `warm_up_sessions_excluded`, carrying the excluded count and, when known, the first tradable
  session's date (or, if the whole run stayed inside warm-up, that no session ever became
  tradable).
- `candle_less_sessions_excluded`, carrying the count of interior gap sessions (sessions _after_
  the warm-up prefix that still lack a universe candle) and naming which metrics they are dropped
  from (`sessions`, `sharpe`, `exposure`) versus which still count them (`cagr`'s elapsed clock,
  `maxDrawdown`, `totalReturn`), since the two domains disagree about a gap by design.

**Union bound, not intersection, stays the web-side clamp's choice (`candleSessionBoundsInRange`,
`apps/web/src/modules/market-data/repositories/candle-repository.ts`).** Bounding a run's period to
the _intersection_ of every universe ticker's own candle history — the range every ticker already
has data for — would silently shrink a run whenever one watchlist ticker listed later than the
rest, with no way for the user to tell a short history from a short request. The union keeps the
period as wide as any one ticker's own history justifies; an interior gap the union bound admits
is now the engine's problem to exclude and note (this ADR), not the web clamp's problem to bound
away.

**Walk-forward windows apply the same filter.** `computeWalkForward`'s `WalkForwardInput` gains the
matching `observed: readonly boolean[]` and `postWarmup: readonly boolean[]`, each sliced per window
exactly like `held` and `rfPerSession` already are; a window whose own slice is mostly warm-up or
gap reports its own honestly small `sessions`, not the window's raw session count, and its own
`cagr` reads its own post-warm-up span within that window.

**`ENGINE_VERSION` bumps from `"0.2.0"` to `"0.3.0"`.** `BacktestState` (the checkpointed shape)
gains two fields, `hasCandle: boolean[]` and `firstTradableSession: SessionDate | null`: a
checkpoint captured before this change has neither, and resuming it under the new code would either
misparse (rejected today by `isValidCheckpointState`'s new `Array.isArray`/`typeof` checks, which
alone would already force `checkpoint_mismatch`) or, worse, silently treat every prior session as
warm-up if a future revision ever defaulted the missing fields instead of rejecting them. Per
ADR-0013's change-policy addendum ("a bump tracks a checkpoint- or persistence-breaking shape
change, never additivity by itself"), this is exactly that class of change, the same one #23 made
for `SimulatedOperation.residualSettledBy`. `NoteCode` gaining two members is additive and would
not by itself justify a bump.

## Consequences

- `packages/engine/src/api.ts`'s frozen block gains `candle_less_sessions_excluded` and
  `warm_up_sessions_excluded` in `NoteCode`/`noteCodes`, and `ENGINE_VERSION` reads `"0.3.0"`;
  ADR-0013 records both as an addendum rather than being rewritten (it is frozen).
- Four golden fixtures under `packages/engine/src/invariants/__golden__` move for the
  `engineVersion` string alone (`iv-rank-late-point.json`, `catch-up-evaluation.json`,
  `ema-rsi-atr.json`, `sma-cross-corporate-actions.json`); no other value in any of them changes.
- `apps/web/src/modules/backtests/strings.ts` gains an `en`/`pt-BR` pair for both codes;
  `report-panel.tsx` surfaces them beside the Sessions stat (`sessionsCodes`), the same treatment
  `short_window_not_annualized` already gets beside `cagr`/`sharpe`.
- `packages/contracts`'s `noteCodeSchema` (`backtest-report.ts`, #91) gains both new codes, guarded
  by `apps/web/src/modules/market-data/enum-drift.test.ts` the same way every other `NoteCode`
  already is.
- Coverage: `packages/engine` stays at or above the 95% line/branch gate.
- **A run already stored under engine `0.2.0` keeps its own numbers; nothing is recomputed.**
  `metrics.sessions`, `cagr`, `exposure`, `maxDrawdown` and `totalReturn` on a persisted
  `BacktestRun` mean whatever they meant when that run's own `provenance.engineVersion` was
  current — a `0.2.0` run's `sessions` still counts every calendar session in its period, gaps and
  warm-up included, and its `cagr`'s exponent read that same raw count. A run comparison (any
  screen or export that places two runs' metrics side by side) can therefore show a `0.2.0` run and
  a `0.3.0` run with `sessions` meaning two different things; `provenance.engineVersion` is the only
  signal that distinguishes them, and nothing in this ticket teaches a comparison view to read it.
  A migration or a versioned-metrics badge on such a view is a follow-up, not addressed here.
