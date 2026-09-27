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
   `sessions`, with no note distinguishing it from a session the strategy actually saw. A
   500-session run at +30% total return with a 60-session interior hole (a ticker halted, a
   staggered-listing gap in a multi-ticker universe) reports `cagr = (1.3)^(252/500) - 1 ≈ 12.53%`
   instead of the `≈ 14.14%` a 440-observed-session run of the same growth would report, and
   `exposure` is understated the same way whenever the gap falls inside a held period.
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

**A session is observed when it carries at least one universe candle and is not in the strategy's
own leading warm-up prefix.** `computeBacktestMetrics` (`packages/engine/src/internal/
backtest-metrics.ts`) gains a required `observed: readonly boolean[]` field on `MetricsInput`,
parallel to `equityCurve`, `rfPerSession` and `held`; it filters all four arrays down to the
observed subsequence before computing anything, so `sessions`, `totalReturn`, `cagr`, `sharpe`,
`maxDrawdown`, `exposure`, `winRate` and `profitFactor` all read the same denominator. Equity is
flat across an unobserved session by construction (no mark could have moved it), so dropping it
from the return series loses nothing but the spurious zero-minus-`rf` term it would otherwise
contribute to `sharpe`. `MIN_ANNUALIZED_SESSIONS` (126) compares against the observed count, so a
run whose observed history is short is still correctly flagged
`short_window_not_annualized` even when its raw period is long.

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
`option_strike_unadjusted_across_corporate_action`):

- `warm_up_sessions_excluded`, carrying the excluded count and, when known, the first tradable
  session's date (or, if the whole run stayed inside warm-up, that no session ever became
  tradable).
- `candle_less_sessions_excluded`, carrying the count of interior gap sessions (sessions _after_
  the warm-up prefix that still lack a universe candle).

**Union bound, not intersection, stays the web-side clamp's choice (`candleSessionBoundsInRange`,
`apps/web/src/modules/market-data/repositories/candle-repository.ts`).** Bounding a run's period to
the _intersection_ of every universe ticker's own candle history — the range every ticker already
has data for — would silently shrink a run whenever one watchlist ticker listed later than the
rest, with no way for the user to tell a short history from a short request. The union keeps the
period as wide as any one ticker's own history justifies; an interior gap the union bound admits
is now the engine's problem to exclude and note (this ADR), not the web clamp's problem to bound
away.

**Walk-forward windows apply the same filter.** `computeWalkForward`'s `WalkForwardInput` gains the
matching `observed: readonly boolean[]`, sliced per window exactly like `held` and `rfPerSession`
already are; a window whose own slice is mostly warm-up or gap reports its own honestly small
`sessions`, not the window's raw session count.

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
- `packages/contracts` has no `noteCodeSchema` mirror yet (`notes.code` is `z.string()`,
  `backtest-run-type-pin.test.ts`), so nothing there needs updating; if one is added later it must
  include both new codes or `enum-drift.test.ts`'s pattern (once extended to `noteCodes`) will
  catch the gap.
- Coverage: `packages/engine` stays at or above the 95% line/branch gate (measured at 96.16%
  branches after this change, up from the pre-change baseline).
