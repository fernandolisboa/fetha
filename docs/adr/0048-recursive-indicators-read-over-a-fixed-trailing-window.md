---
status: accepted
date: 2026-09-29
---

# Recursive indicators are read over a fixed trailing window of sessions at each evaluated candle (amends 0013)

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
evaluator) reads `ema`, `rsi` and `atr` over a trailing window ending at `c`, never over everything
the view holds before `c`. The seed is the start of that window, never the start of the view.
`sma` and `iv_rank` are unchanged: they have no memory beyond their own lookback.

- **Window size.** `ema` reads `3 * length` candles; `rsi` and `atr` read `6 * length`. The seed's
  residual weight after the window is `(1 - 2/(L+1))^(2L)` for EMA (under 2%) and
  `((L-1)/L)^(n-1-L)` for Wilder smoothing over `n` candles, which decays slower: at `3 * length`
  it is still 13.5% for L = 14, at `6 * length` it is 0.6%. The sizes live in one place,
  `internal/indicator-warm-up.ts`, read by both `dataWindow` (how much history to request) and the
  evaluator (how much of it to read).
- **Bounded by calendar sessions, not by a count of candles.** The window is every candle of the
  ticker whose session is on or after the earliest session that `dataWindow`'s own walk reaches
  from `c`'s `asOf` for that many candles (the same code, `earliestCandleSession` in
  `internal/data-window.ts`). A session with no candle for the ticker (a halt, an illiquid day)
  leaves the window one candle short rather than pulling in an older candle: a count would reach
  further back in a long view than a short view ever loaded, and the two readings would differ.
- **Where the window ends.** At `c`'s `asOf` when the call has a `since` (every candle it reads is
  after `since`). Without `since` the call reads the latest candle at or before `at`, which can be
  older than `at`'s own session when the ticker has no candle there (a halt): the window then ends
  at `at`, the anchor `dataWindow`'s view was built from, so that candle's reading as of `at`
  never needs a session the view lacks. A backtest evaluates each session the same way (no
  `since`, `at` = the session's close), so it agrees with a one-night run on that reading too.
- **Fallback.** When the view's calendar has no session at or before the window's end, the window is the last
  `3 * length` or `6 * length` candles present. `dataWindow` itself returns the whole calendar in
  that case, so nothing narrower is guaranteed to be in the view.
- `engine.indicators()` is unchanged: it returns a series over the view it is given, which is what
  a chart draws. A chart over a longer history can therefore show a last point that differs from
  the reading a condition acts on by the residual above (under 2% of the seed's weight).
- A reading is computed only when the evaluated condition reads it (entry specs when nothing is
  open, the open operation's rule specs otherwise), and memoized per instant. The per-epoch series
  #58 caches still computes and validates the three kinds; the evaluator no longer reads their
  values.
- `ENGINE_VERSION` moves from `0.3.0` to `0.4.0`, although no checkpointed or persisted shape
  changes (ADR-0013's change policy bumps only for those, and ADR-0038's value-only sizing fix did
  not bump). This change is different in kind: it moves the indicator readings conditions act on,
  for every strategy that reads a recursive indicator, at every session. Signals and evaluations
  store `engineVersion` in their provenance, so a re-evaluation of a session recorded under `0.3.0`
  can tell that a moved reading comes from the rule, not from the data; and a backtest paused under
  `0.3.0` fails with `checkpoint_mismatch` instead of mixing the two rules in one run. The
  ADR-0013 addendum adds this case to the change policy.

## Consequences

- A reading is a function of the calendar, the window's end and the ticker's candles in its window
  alone. Any view that holds every candle of those sessions reads it identically: a one-night run,
  any catch-up covering the candle, a re-evaluation and a backtest bar. The one exception is by
  design: a ticker with no candle in `at`'s session, read without `since`, reads its latest candle
  as of `at` (a window that ends later), so a catch-up that reads the same candle at its own session
  can differ; after a halt longer than the window, that reading is `null` and the entry condition
  is `insufficient_data`, in a backtest bar as in a one-night run. `dataWindow` guarantees that for
  its own views, because the window of a candle evaluated after `since` never starts before the
  window of `since` itself, and `apps/web` loads every candle of every session from `from` on.
  The walk starts from the candle's `asOf`, so the identity also assumes a daily candle is stamped
  at or after its session's close as the view's calendar records it, which ingestion does
  (`asOf` = the calendar close). A calendar revision that moves a close later than an already
  stamped candle's `asOf` would walk one session further back for that candle.
  Tests pin it: the recursive-warm-up invariance property test for `evaluateStrategy`, a
  one-night versus catch-up test with and without missing sessions, and a backtest golden test
  that runs the same period over views with and without 18 older sessions, then again with a
  third of the warm-up sessions missing (each fails on the previous rule).
- The ADR-0013 "Indicators" rationale for the warm-up (so live and backtest readings converge)
  becomes an exact identity instead of an approximation.
- `dataWindow` requests `6 * length` sessions for `rsi` and `atr` instead of `3 * length`: an
  RSI(14) strategy loads 84 sessions of candles instead of 42, and a strategy with option legs
  loads the option series and day prices of those sessions too, so it reaches `loadMarketView`'s
  row caps (`MarketViewTooLargeError`) sooner.
- Cost: a recursive reading is now O(window) Decimal operations per evaluated candle instead of
  O(1) amortized. `ema` computes only its seed SMA and `rsi` only its last ratio, and readings are
  lazy. On the #58 benchmark shape (1,250 sessions x 20 instruments) with an EMA(50) and RSI(14)
  entry and its negation as exit, one call takes about 18 s against 3.5 s before on the same
  machine; the SMA benchmark is unchanged (about 3 s). `apps/web` already runs backtests in
  time-boxed chunks, so a slower run takes more chunks, not a timeout. If that becomes a
  bottleneck, seeding at fixed calendar boundaries (so consecutive candles share a seed and one
  series) is the next step; it is not needed now.
- Old evaluations and backtest runs keep their `0.3.0` provenance; nothing is recomputed.
