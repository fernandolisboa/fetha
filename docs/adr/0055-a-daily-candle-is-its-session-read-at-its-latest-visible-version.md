---
status: accepted
date: 2026-09-30
---

# A daily candle is its session, read at its latest visible version (#38, amends 0013)

## Context

`MarketView.candles` rows are unique by `(ticker, timeframe, asOf)`, so a view may hold two `D1`
rows for the same session with different `asOf`: a first publication and a later restatement (a
corrected COTAHIST file, a late adjustment). The engine treated each such row as a separate candle.
A series built at an instant after both held the session twice, a moving average counted it twice,
a catch-up evaluated it twice, and the lookups that pick one row per session (`rowOnSession`,
`lastKnownRow`, fills) picked whichever came first in the array, which broke I3.

The app never builds such a view today: `candles` is keyed by `(ticker, timeframe, session)` with
`asOf` set to the session's close, so a restated row replaces the stored one (the guard test from
PR #252 pins this). The owner chose on 2026-09-30 to fix the engine rule anyway, rather than wait
for stored candle history, so any view that does carry versions reads correctly.

## Decision

A `D1` candle is identified by `(ticker, session)`. At an instant `t`, a session's candle is its
latest version with `asOf <= t`, the first-listed on an equal `asOf`. Intraday candles stay keyed
by `asOf`: two bars of one session are two candles.

- **Series** (`buildCandleSeries`, and through it `engine.indicators()`): a session appears once, in
  the slot its first version took, carrying the latest version visible at the series' instant.
  Sessions therefore stay in the order they were first published, and a view without restatements
  orders exactly as before. The series also exposes each slot's first `asOf`; `iv_rank` aligns IV
  points to it, since a restatement's own `asOf` can be later than the next session's candle.
- **Evaluation** (`evaluateStrategy`): a restatement is never an evaluation instant of its own.
  - A catch-up (`since`) evaluates each session once, at its first version's `asOf`, with what was
    visible then: the session as first published, plus any earlier session's restatement already
    out. A later session reads the restatement.
  - A call without `since` reads the latest session at its version visible at `at`, and is
    evaluated at the latest `asOf` among the ticker's visible daily rows, which may be an earlier
    session's restatement. That keeps the record's instant the latest data it read.
  - The #58 per-epoch series cache assumes the series at an instant is a prefix of the series at a
    later one; a restatement breaks that, so a ticker with a restated session recomputes its series
    at each instant. A ticker without one keeps the cache.
- **Lookups** that pick one row per session read its latest version visible at the instant:
  `rowOnSession` and `lastKnownRow` (backtest fills, marks and last-known closes),
  `resolveFillOpportunity` (stock candles and option day prices, for `score`'s counterfactual), and
  the underlying spot and a stock's mark from candles (`resolveUnderlyingSpot`,
  `resolveLegMarketPrice`). The spot is the session published last (the series' last slot) at its
  latest visible version, not the row with the greatest `asOf`, so an old session's restatement
  never becomes the current price. `markToMarket`, `proposeSettlement` and `score`'s
  horizon close already read `latestVisible` per session.
- `validateViewIntegrity` keeps rejecting a duplicate `(ticker, timeframe, asOf)`; two versions of
  one session are valid input.
- `ENGINE_VERSION` moves from `0.6.0` to `0.7.0` (ADR-0013's change policy, 0.4.0 case: a reading
  conditions act on can change), with an ADR-0013 addendum.

## Considered options

- **Keep the rule deferred** until candle history is stored. Rejected by the owner: the fix is
  contained in the engine and costs nothing on views without restatements.
- **Evaluate a restatement as its own instant** in a catch-up. Rejected: a session would get two
  evaluation records and could raise two signals, and a one-night run, which never saw the first
  version, could not agree with a catch-up over the same night.
- **Order sessions by date instead of first publication.** Rejected: it would reorder every view
  whose `asOf` and session orders disagree, moving goldens with no restatement in them, for no case
  the app produces.

## Consequences

- A view with a restated daily session yields one candle for it in every computation; an
  evaluation instant between the two `asOf` values reads the earlier version (I1 holds), and any
  input order yields the same artifacts (I3 holds). `restated-candles.property.test.ts` draws
  restated sessions and pins I1, I3 and catch-up equivalence over them, since the shared
  arbitraries draw one version per session.
- A catch-up and the nightly runs that led up to it agree session by session as long as no
  restatement becomes visible between a session's first publication and the night that evaluates
  it; otherwise that night reads the restatement and the catch-up does not. The app keys signals
  and evaluations by session, so it keeps one record either way.
- `engine.indicators()` output can list a restated candle whose `asOf` is later than the next
  slot's; consumers must order by slot, not by `asOf`.
- A ticker with a restated session loses the #58 cache and costs one series build per evaluated
  instant. The app produces no such views today.
