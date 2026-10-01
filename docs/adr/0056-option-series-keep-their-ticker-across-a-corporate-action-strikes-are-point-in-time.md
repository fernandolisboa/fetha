---
status: accepted
date: 2026-09-30
---

# Option series keep their ticker across a corporate action; strikes are point-in-time (#69, amends 0014, 0017)

## Context

B3's real behavior, verified against COTAHIST for BBAS3's 2-for-1 split (ex-date 2024-04-16): all
231 option series traded on both the last pre-split session and the first post-split session kept
their own ticker and ISIN, with `PREEXE` (strike) halved and rounded to the cent —
`BBASB310` `29.95` → `14.98`, `BBASD350` `27.19` → `13.60`. B3 lowers a series' strike the same way
for a cash dividend. This amends ADR-0014 (via ADR-0013's #23 addendum, "a real split forces a
re-listed, exchange-adjusted option series") and ADR-0013's own "known gap" note that assumed a
split forces a series rollover (a new ticker): the ticker and ISIN are stable across the event, only
the strike moves.

`option_series` (ADR-0017) is keyed by ISIN and upserted by the nightly registry: `ticker`,
`underlying`, `right`, `strike`, `expiry` and `style` update on every conflict, but `as_of` is set
once on insert and only ever moves backward. Once a strike changes, the row's `strike` column
becomes the _latest_ value while its `as_of` stays the _earliest_ one the row has ever carried —
every `MarketView` built from that row, however old the instant it is built for, sees the
post-event strike stamped with a pre-event `asOf`. `buildOperationMarketView`'s own price-matching
(`optionPricesByTicker`) compares a day-price row's own strike against that single, always-current
series strike, so a pre-event `option_daily_prices` row (correctly stamped with the pre-event
strike) is silently dropped once the registry has moved past it — the fix in this ADR closes that
symptom too, since the series row is no longer a single strike but a strike history.

This ADR is scoped to the market-data layer: the data model, the writers and the loaders. It does
**not** rebase an _open operation's_ option legs across the event the way ADR-0014 Q51 already
does for stock legs (`splitFactorProduct`) — that remains the engine gap ADR-0013's #23 addendum
flagged (`option_strike_unadjusted_across_corporate_action`), tracked as a follow-up PR of the same
issue (#69). Resolved by #69 part 2, ADR-0013 `0.8.0` addendum: strike from the latest visible
epoch; derived only for a factor ex-dated on the pricing session itself (capped at expiry);
otherwise kept and flagged `option_strike_unadjusted_across_corporate_action` (repurposed).

## Decision

**A strike epoch** is the first instant a listing cycle `(ticker, expiry, right)` is known to have
carried a given `strike`. `option_series_strikes` (migration 0033) stores one row per epoch:

```sql
CREATE TABLE option_series_strikes (
  ticker  text NOT NULL,
  expiry  date NOT NULL,
  right   text NOT NULL,
  strike  numeric(18, 8) NOT NULL,
  as_of   timestamptz NOT NULL,
  PRIMARY KEY (ticker, expiry, right, strike)
);
```

Reference data (CLAUDE.md's read-only exception): no `user_id`, no isolation test, the same class
as `option_series` itself.

- **Writers.** `upsertOptionSeries` (the nightly registry) and `upsertOptionDailyPrices` (COTAHIST)
  each upsert the epoch they just observed — `(ticker, expiry, right, strike)` from the row they are
  already writing, `as_of` the same instant that write already carries (`ingest.ts` calls both with
  that session's own close, `trading.close`) — with `ON CONFLICT (ticker, expiry, right, strike) DO
UPDATE SET as_of = LEAST(existing, excluded) WHERE existing.as_of > excluded.as_of`. The same
  monotonic rule ADR-0017 already uses for `option_series.as_of`: a re-ingested older snapshot can
  never erase a newer epoch a later run already recorded; the `WHERE` guard additionally skips the
  row rewrite entirely once an epoch's `as_of` can no longer move, which is every night for a series
  whose strike has not changed since it was first epoched. `option_series.strike` is untouched and
  stays the current strike, the value search and the series page read. The row write (`option_series`
  or `option_daily_prices`) and the epoch write are two separate statements that autocommit one by one
  (ADR-0017: `run()` writes through the plain handle, outside the lock's transaction). A crash between
  them on a strike-change session leaves the new row with only the old epoch until the session is
  ingested again: no `succeeded` marker was written, so the retry redoes both statements and the
  epoch catches up. The conflict target is a numeric column, but
  the registry hands over strikes as unnormalized text (`"340"`, `"100,39"` pre-parse); two ISINs on
  one `(ticker, expiry, right)` whose strikes differ only textually (`"14.98"` vs `"14.980"`) are the
  same numeric value and the same conflict target, so the in-memory dedupe key before the batched
  `INSERT` normalizes the strike (`new Decimal(strike).toFixed(8)`) rather than comparing the raw
  strings — otherwise a single batch could try to affect the same conflict target twice, which
  Postgres refuses.
- **Backfill (same migration).** Every strike B3 has ever priced becomes an epoch from history
  already ingested, no new source, in three steps:
  1. `INSERT ... SELECT ticker, expiry, right, strike, min(as_of) FROM option_daily_prices GROUP BY
ticker, expiry, right, strike ON CONFLICT DO NOTHING` — one epoch per distinct strike ever
     traded, dated its earliest trade.
  2. For a `(ticker, expiry, right)` cycle with **no other-strike price row** (never traded, or
     only ever traded at the one strike `option_series` already shows): `INSERT ... SELECT ticker,
expiry, right, strike, min(as_of) FROM option_series ... GROUP BY ticker, expiry, right,
strike ON CONFLICT DO UPDATE SET as_of = LEAST(existing, excluded)` — the registry's own
     current strike and `as_of`, `LEAST`-folded across duplicate ISINs on the same natural key.
     Safe here only because there is no other-strike trade this strike could misdate: with nothing
     to compare against, the registry's own `as_of` is the earliest instant this strike is known
     to have existed.
  3. For a cycle that **does** have other-strike price rows (the corporate-action case: the cycle
     traded at an old strike, then the registry moved to a new one): the current strike is dated
     `GREATEST(option_series.as_of, the open of the first trading session whose close is later
than the last other-strike trade's own as_of)` — never the last old-strike trade's own close,
     and never `LEAST`ed against the series' possibly pre-event `as_of` the way step 2 folds it.
     The old strike stops being current strictly after its last observed trade; the new strike can
     only be dated from the very next session, the earliest instant nothing contradicts it yet.
     `ON CONFLICT DO NOTHING`, since a strike already epoched by step 1 or 2 needs no correction
     here.

  **Invariant, scoped to this backfill:** within one `(ticker, expiry, right)` cycle, no two strikes
  the three steps above insert ever land on the same `as_of`. Step 1 dates a strike at a session's
  own close (`option_daily_prices.as_of`); step 3 dates the current strike at a session's own open
  (or later, the registry's own `as_of`) — never the same instant a trade-derived epoch can carry,
  since a session's open and close are always distinct timestamps. Step 2 only ever fires for a
  cycle with a single strike in play, so it has no other epoch in the group to collide with.
  Enforced by an integration test, not the schema: the primary key is `(ticker, expiry, right,
strike)`, not `(..., as_of)`, so nothing at the database level actually forbids two strikes
  sharing an `as_of` — it is a property of how the three backfill steps choose their timestamps,
  not a constraint. **The live writers do not share this guarantee.** `ingest.ts` calls both
  `upsertOptionSeries` and `upsertOptionDailyPrices` with the same `as_of` for a session (`trading.
close`): if the registry and COTAHIST ever disagreed about a session's strike for the same cycle
  (the registry already shows the adjusted strike while COTAHIST still reports the old one, or vice
  versa), both epochs would land on that session's own close, violating the invariant going
  forward. `collapseSeriesByTicker`'s tie rule (`isEarlierOnExactTie`, ADR-0013's #21 addendum,
  "Selection tie-breaks are deterministic") then decides the collapsed view on an exact tie by
  taking the lower strike. Not observed in the real BBAS3 files — the registry and COTAHIST agree
  on the strike for both 2024-04-15 and 2024-04-16 — so this is a documented residual, not a
  reproduced failure.

- **Loaders.** Every place that builds `OptionSeries[]` for the engine now emits one row per epoch:
  `strike` and `asOf` come from `option_series_strikes`, `underlying` and `style` from
  `option_series`, left-joined on `(ticker, expiry, right)`, filtered by
  `coalesce(epoch.as_of, option_series.as_of) <= ceiling`. The `COALESCE` fallback to
  `option_series`'s own `strike`/`as_of` applies only to a cycle with **zero** matching epoch rows
  (a write from before this ADR landed, or a gap the backfill did not reach) — it resolves exactly
  as it did before this table existed. A cycle that **does** have epoch rows is filtered by each
  row's own `as_of`: an epoch recorded later than the queried instant is simply **absent** from
  that query's result, never shown early at its eventual strike. This needed no engine change:
  `resolveSeries`/`collapseSeriesByTicker`
  (`packages/engine/src/internal/resolve-series.ts`) already resolve the latest-visible-`asOf` row
  per ticker among however many `MarketView.optionSeries` rows share that ticker (ADR-0013's #23
  addendum) — the engine was built for several rows per ticker from the start, only the loader ever
  produced just one.
  - `optionSeriesInWindow` (`loadMarketViewWithCalendarVersion`) and `optionSeriesForUnderlyingAt`
    (`buildOperationMarketView`) both switch to the epoch join. `optionChainForUnderlying`,
    `searchOptionSeries` and `optionSeriesDetail` (the closing chain, the Ctrl K palette, the series
    page) keep reading `option_series` directly — they show the _current_ strike by design, the same
    thing the registry already gives them, and multiplying their rows by epoch would only add noise
    to a UI that has never shown history.
  - `optionChainTickerCap` (`DEFAULT_OPTION_CHAIN_TICKER_CAP`) now bounds distinct tickers, not
    rows: one series can contribute more than one epoch row, so a row-count cap would refuse a
    universe under the real ticker bound just because a handful of its series each split twice. A
    two-step query first bounds the ticker count to `cap + 1` (refusing before it ever
    materialises an epoch row) and only then fetches the epoch rows for exactly those tickers, so
    the follow-on price query's `inArray` bind list stays within the same limit it always has. The
    epoch rows themselves are not separately capped (KISS): `DEFAULT_OPTION_CHAIN_TICKER_CAP`
    tickers times a handful of epochs each is far under the volume
    `DEFAULT_OPTION_PRICE_ROW_CAP` already treats as safe for the heavier follow-on price query,
    which is untouched — `option_daily_prices` is not epoch-joined and its row volume does not
    change.
  - `buildOperationMarketView`'s price/series match (`optionPricesByTicker`) already compares a
    day-price row's strike against the _latest series row visible at `at`_ — now that "series row"
    is the epoch visible at `at`, the match resolves correctly for any strike the backfill or a
    writer has actually epoched: a pre-event price row matches the pre-event epoch, a post-event
    one matches the post-event epoch. No change was needed to that comparison itself; it inherits
    the residuals below (an unepoched strike, an append-only correction) the same as every other
    loader.
  - The IV index (`iv-index-compute.ts`) computes through `buildOperationMarketView`, so it reads
    the strike of the epoch visible at its own session close with no change of its own; documented
    here since the ticket called it out explicitly.
  - `mergeMarketViews` (`portfolio-view.ts`) already deduplicates `optionSeries` on
    `ticker|expiry|strike|asOf`, so several epochs per ticker across merged views collapse
    correctly with no change.

## Trade-offs

- **A series untraded before the event has no old-strike epoch — a blind window, not a leak.** The
  backfill only ever learns a strike from a price row that actually exists or from the registry's
  own current row; a series with no `option_daily_prices` row before the event has nothing to
  derive an old-strike epoch from — its pre-event strike is unknowable from data we hold, not
  merely un-backfilled. Concretely: a series registered before its first trade, whose strike later
  changes, is **absent from `MarketView`** between its registry sighting and its first old-strike
  trade if the registry's own sighting ever lands on the post-event strike before any trade data
  does — `epochAsOfCondition` filters an epoch dated later than the queried instant out of the
  result entirely, it does not fall back to showing that epoch's strike early. A cycle whose strike
  never changes keeps its registry `as_of` from the first sighting onward via step 2's `LEAST`, so
  this blind window only ever applies to a cycle a corporate action actually touches.
- **An inferred current-strike epoch's visibility can predate the real ex-date.** Step 3 dates the
  current strike from the session after the _last observed old-strike trade_, not from the
  corporate action's actual ex-date; if the old strike stopped trading days before the real event
  (a common illiquid-series pattern), the new strike becomes visible in `MarketView` earlier than
  it was actually listed. `corporate_action_factors.ex_date` (ADR-0052) exists for the underlying
  and could in principle bound step 3 more tightly when a factor row is already on file — not taken
  here (YAGNI): a series in this exact gap has no price row of its own near the event, so it cannot
  fill or mark an operation; the only thing an earlier-than-real visibility can affect is which
  strike a leg-selection step picks, which #69's follow-up (the engine's own corporate-action
  rebasing) is better placed to address alongside the stock-leg case it already handles. The bound
  is one-sided (never later than reality) and self-corrects the moment the old strike's actual last
  trade is captured by a later ingest.
- **A current strike whose last other-strike trade sits on the very last stored session gets no
  backfilled epoch.** Step 3's `next_session` lookup needs a trading session whose close is later
  than that last old-strike trade; if none is stored yet, the `LATERAL` join drops the cycle and
  the current strike stays invisible until the next ingestion run. This self-heals without a
  migration fix: `upsertOptionSeries` writes its own epoch (`LEAST`-folded, same as every other
  registry write) the next time the nightly registry snapshot runs, at the latest by the next
  ingestion cycle — the same convergence the illiquid-series trade-off above already accepts.
- **Dividend-driven strike adjustments are covered for free**, the same epoch mechanism, no extra
  work: B3 lowers a strike for a cash dividend the same way it does for a split, and any such change
  the registry or COTAHIST ever reports becomes its own epoch.
- **Visibility is decided by the epoch's own `as_of` alone.** The loaders' `epochAsOfCondition`
  reads `coalesce(option_series_strikes.as_of, option_series.as_of)`; `option_series.as_of` no
  longer gates visibility once an epoch row exists for that strike. A strike is visible from its
  own epoch, full stop — there is no second, independent check against the series row's own
  `as_of` a caller could rely on.
- **Epochs are append-only; a COTAHIST strike correction leaves the wrong epoch in place.** Nothing
  in the writers or the backfill ever deletes or revises an epoch once inserted — `as_of` can only
  move earlier (`LEAST`), never the `strike` a given `as_of` was recorded against. If a source ever
  corrects a previously-ingested strike (as opposed to a corporate action genuinely changing it),
  the wrong epoch survives until manually removed; this ADR does not add a correction path.
- **A strike revert reads as an old epoch, resurfacing at its original `as_of`.** B3 has never been
  observed reverting a strike once adjusted; this is an accepted risk, not a modeled case.
- **An ISIN whose expiry or right changes orphans its epochs.** `option_series_strikes` is keyed by
  `(ticker, expiry, right, strike)`, not by `isin`; if a registry correction changes a series'
  `expiry` or `right` under the same ISIN, its existing epochs stay keyed to the old
  `(expiry, right)` and are never migrated to the new one. The series resolves against no epoch
  (falling back to `option_series`'s own row via `COALESCE`) until new epochs accumulate under the
  corrected key. B3 has not been observed changing a listed series' expiry or right in place; this
  is an accepted risk, not a modeled case.
- **Still open, tracked in #69's follow-up:** an _open operation's_ option leg is not rebased across
  a split or dividend the way its stock legs already are (ADR-0014 Q51). `settlement_pending`/
  `option_strike_unadjusted_across_corporate_action` still applies until the engine itself adjusts a
  held option leg's strike; this ADR only fixes what the market view carries, not how an open
  position reads it. Resolved by #69 part 2, ADR-0013 `0.8.0` addendum: strike from the latest
  visible epoch; derived only for a factor ex-dated on the pricing session itself (capped at
  expiry); otherwise kept and flagged `option_strike_unadjusted_across_corporate_action`
  (repurposed).

## Amends ADR-0017

**"Option series identity"** (adapters/b3-instruments section) gains one clause: the strike's own
history sits beside the ISIN key. `option_series.isin` remains the stable identity `ticker` alone
cannot give (B3 reuses a ticker across listing cycles); `option_series_strikes`, keyed by
`(ticker, expiry, right, strike)`, is the strike's own point-in-time history within one listing
cycle — a second, narrower kind of "more than one row can matter for a lookup" than the reused-ticker
case ADR-0017 already documents, and orthogonal to it: a listing-cycle rollover changes the ticker
and the expiry; a corporate action changes the strike alone, in place.

## Considered options

- **Version `option_series` itself, one row per `(isin, strike)`** instead of a separate table:
  rejected — `isin` is the primary key search, the palette and the series page all rely on for a
  single current row, and versioning it would mean every one of those reads filtering to the latest
  version by hand instead of the natural-key primary key they use today. A separate table keeps
  `option_series` exactly as every non-engine reader already needs it.
- **Store the split factor and rebase at read time**, mirroring the stock-leg approach
  (`corporate_action_factors`, ADR-0014 Q51): rejected for this ticket — the owner has no
  labeled-event source for option strikes the way #50 built one for stock corporate actions
  (ADR-0052), and COTAHIST/the registry already hand over the adjusted strike directly, needing no
  factor or rebasing arithmetic at all. Revisit if a future engine change (the #69 follow-up) needs
  a factor rather than a resolved strike.
