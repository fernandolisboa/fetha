---
status: accepted
date: 2026-09-29
---

# Recursive indicators are read over a fixed trailing window at each evaluated candle (amends 0013)

## Context

#239, found by the quant review of #84 (PR #237). `dataWindow()` anchors a view's `from` on
`since` when a call catches up several sessions, and `evaluateStrategy` read every indicator from a
series computed over the whole view. The recursive indicators seed at the start of whatever they
are given: `ema` on the SMA of its first `length` closes, `rsi` on its first `length` changes, `atr`
on its first `length` true ranges. So the same session S read inside a 3-session catch-up saw three
more candles of history than a one-night run evaluating S alone, and its EMA, RSI and ATR differed
slightly (a seeded random walk: EMA20 by 1.6e-3 on a R$ 39 close, RSI14 by 0.12 to 0.25 points).
A condition sitting on its threshold (`rsi(14) < 30` at 29.95) could flip between a catch-up and a
one-night run, or between the nightly run and a re-evaluation of the same session, with no data
change. The same held for a backtest: its view starts at the run's own period, so its readings at S
depended on where the run began.

## Decision

At every evaluated candle `c`, `evaluateStrategy` (and so `runBacktest`, which uses the same
evaluator) reads `ema`, `rsi` and `atr` over exactly the trailing window `dataWindow` requests for
them: the `3 * length` adjusted candles ending at `c` (fewer only when the view holds fewer,
i.e. the instrument's own history is shorter). The seed is the start of that window, never the
start of the view. `sma` and `iv_rank` are unchanged: they have no memory beyond their own
lookback, so their full-series reading already equals the trailing one.

- The warm-up count lives in one place, `internal/indicator-warm-up.ts`, read by both
  `dataWindow` (how much history to request) and the evaluator (how much of it to read).
- `engine.indicators()` is unchanged: it returns a series over the view it is given, which is
  what a chart draws. Only the readings a strategy evaluation acts on change.
- A reading is computed only when the evaluated condition reads it (entry specs when nothing is
  open, the open operation's rule specs otherwise), and memoized per instant.
- `ENGINE_VERSION` moves from `0.3.0` to `0.4.0`, although no checkpointed or persisted shape
  changes (ADR-0013's change policy bumps only for those, and ADR-0038's value-only sizing fix did
  not bump). This change is different in kind: it moves the indicator readings conditions act on,
  for every strategy that reads a recursive indicator, at every session. Signals and evaluations
  store `engineVersion` in their provenance, so a re-evaluation of a session recorded under `0.3.0`
  can tell that a moved reading comes from the rule, not from the data; and a backtest paused under
  `0.3.0` fails with `checkpoint_mismatch` instead of mixing the two rules in one run. The
  ADR-0013 addendum adds this case to the change policy.

## Consequences

- The reading at session S is a function of the `3 * length` candles ending at S alone, so a
  one-night run, any catch-up covering S, a re-evaluation of S and a backtest bar at S agree
  exactly on it. The recursive-warm-up invariance property test pins it for `evaluateStrategy`,
  and a backtest golden test runs the same period over views with and without 18 older sessions
  and expects identical runs (it fails on the previous rule).
- The ADR-0013 "Indicators" rationale for the `3 * length` warm-up (so live and backtest readings
  converge) becomes an exact identity instead of an approximation.
- Cost: a recursive reading is now O(`3 * length`) per evaluated candle instead of O(1) amortized.
  `ema` no longer computes an SMA at every position (it only needs the seed), and readings are
  lazy. On the #58 benchmark shape (1,250 sessions x 20 instruments) with an EMA(50) entry and an
  RSI(14) exit, one call takes about 13 s against 4.7 s before; the SMA benchmark is unchanged
  (about 3 s). `apps/web` already runs backtests in time-boxed chunks, so a slower run takes more
  chunks, not a timeout.
- Old evaluations and backtest runs keep their `0.3.0` provenance; nothing is recomputed.
