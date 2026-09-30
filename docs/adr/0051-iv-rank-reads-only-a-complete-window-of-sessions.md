---
status: accepted
date: 2026-09-29
---

# An IV rank is read only when its whole window of sessions holds an IV point (#254, amends 0050)

## Context

ADR-0050 made `sma` read only when its last `length` candles all fall inside the window of
`length` sessions `dataWindow` requests, so a one-night run, a catch-up, a re-evaluation and a
backtest bar agree on a ticker with a session missing. It left `iv_rank` out: the rank is computed
over the last `lookbackSessions` implied-volatility index points present, while `dataWindow`
requests `lookbackSessions` _sessions_ of them (one more while the anchor session is still open,
since its point is published at the close). With a session missing inside that span, the
one-night view held `lookbackSessions - 1` points and read `null`, while a catch-up or a backtest,
whose views start earlier, held one older point and read a number.

A point published after its own session (`asOf` later than the session's close) has the same
effect while it is not yet visible: a backtest bar, holding the whole history, skipped it and
ranked over one older point; the one-night run of the same day did not hold that older point.

## Decision

Strict, as for `sma` (ADR-0050 weighed the tolerant alternative and its cost; the same cost
applies, since widening the IV window moves `from` back for every collection). At each evaluated
candle, `evaluateStrategy` reads `iv_rank(lookbackSessions)` only when the oldest of the
`lookbackSessions` points it ranks has a session on or after the earliest session of the IV window
`dataWindow` walks for the window's end (`earliestIvSession`, now shared with `dataWindow`; the end
rule is ADR-0048's: the candle's `asOf` with a `since`, `at` without). Otherwise the reading is
`null`. The points it ranks are the ones `computeIndicators` ranks for that candle: the ticker's
points by session, those visible when the series is built, up to the one aligned to the candle.
When the view's calendar does not reach the window's end, the rank is read as before.

- `dataWindow`'s request for `iv_rank` is unchanged, as is `engine.indicators()`: the rule lives in
  the evaluator, like ADR-0050's.
- `ENGINE_VERSION` moves from `0.5.0` to `0.6.0` (ADR-0013's change policy, 0.4.0 case), with an
  ADR-0013 addendum.

## Consequences

- A session's IV rank is a function of the calendar, the window's end and the underlying's IV
  points in that window alone: every view `dataWindow` builds for the same window end reads it
  identically.
- An underlying with a session missing from its IV index stays rank-silent for `lookbackSessions`
  sessions after it, in backtests and catch-ups as in the nightly run. A point published late
  leaves the rank unread from its session until it is published.
- A D1 IV point's `asOf` must be its session's close, the instant the COTAHIST candles of that
  session carry (`ingest.ts` stamps candles with the calendar close), not the time it was
  computed. A point stamped after its session's candle is a point published late: the candle aligns
  to the previous point, whose window reaches one session too far back, so the rank is never read.
  The IV index job (#81) must stamp points that way.
- The IV index is produced by the app itself (#81), not by the exchange, so a missing point is a
  failure of that job, and it costs a lot: one missing session silences an `iv_rank(252)` for a
  year on that underlying. #81 must write one point per session per underlying, or backfill a
  missed one, rather than rely on this rule to tolerate gaps.
- Exit rules read the same reading: a `condition` exit on `iv_rank` evaluates to unknown while a
  missing session stays in its window, as ADR-0050 describes for `sma`.
- No run in the app changes today: there is no IV index ingestion yet (#81), so the nightly run and
  the backtest action refuse a strategy that reads `iv_rank` before evaluating it
  (`canSatisfyCollection`). The rule is the engine's, and applies to both once #81 lands.
  (Superseded: ADR-0054 removes `canSatisfyCollection` once the IV index ingestion this note
  describes as missing ships; a strategy that reads `iv_rank` too early now reads
  `insufficient_data` like any other under-warmed indicator, instead of being refused outright.)
