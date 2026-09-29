---
status: accepted
date: 2026-09-29
---

# An SMA is read only when its whole window of sessions holds a candle (#250, amends 0048)

## Context

ADR-0048 bounded the `ema`, `rsi` and `atr` readings by calendar sessions so that a session
without a candle for the ticker (a halt, an illiquid day) no longer changes them between a
one-night run, a catch-up, a re-evaluation and a backtest bar. `sma` kept reading the last
`length` candles present before the evaluated candle, while `dataWindow` requests `length`
_sessions_ for it. With a session missing inside that span, the one-night view held `length - 1`
candles and read `null` (the entry is `entry_condition_warmup`), while a catch-up or a backtest,
whose views start earlier, held one older candle and read a number. The same session could give no
signal in the nightly run and a signal in a re-evaluation or a backtest.

Two ways out were weighed:

- **Tolerant**: request more sessions for `sma` (for example `2 * length`) and read the last
  `length` candles inside that wider window. Readings survive a few missing sessions, but every
  collection `dataWindow` loads goes back further with it: an option strategy with an SMA(200)
  entry on a liquid underlying would load 400 sessions of option day prices instead of 200, close
  to `loadMarketView`'s 200,000-row cap.
- **Strict**: keep the request at `length` sessions and read the SMA only when its last `length`
  candles all fall inside it. No extra data, and it is what the nightly run already does today.

## Decision

Strict. At each evaluated candle, `evaluateStrategy` reads `sma(length)` from the series only when
the candle `length - 1` positions back is on or after the earliest session of the window of
`length` sessions ending at the window's end (`earliestCandleSession`, the walk `dataWindow` uses,
with ADR-0048's end rule: the candle's `asOf` with a `since`, `at` without). Otherwise the reading
is `null`. When the view's calendar does not reach the window's end, the reading falls back to the
last `length` candles present, as ADR-0048's fallback does.

- The recursive kinds keep ADR-0048's tolerant rule: their windows are `3 * length` or
  `6 * length` sessions, so a short window still holds enough candles to seed them.
- `iv_rank` has the same shape of divergence (it ranks the last `lookbackSessions` index points,
  not the points inside that many sessions) but needs the index points' sessions inside the
  evaluator, which it does not have today; it is tracked as its own issue.
- `ENGINE_VERSION` moves from `0.4.0` to `0.5.0` (ADR-0013's change policy, 0.4.0 case), with an
  ADR-0013 addendum.

## Consequences

- A session's SMA reading is a function of the calendar, the window's end and the ticker's
  candles in that window alone, like the recursive readings: every view `dataWindow` builds reads
  it identically.
- A ticker with a session missing stays SMA-silent for `length` sessions after it, in backtests
  and catch-ups as in the nightly run. Backtests over illiquid tickers produce fewer SMA entries
  than before; the backtest golden with one gapped ticker lost that ticker's SMA signals. Liquid
  tickers, which have a candle every session, are unchanged.
- Nightly runs change only in the rare case where a catch-up read a gapped window; a one-night run
  already read `null` there.
