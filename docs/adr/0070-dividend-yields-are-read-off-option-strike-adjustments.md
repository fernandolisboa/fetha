---
status: accepted
date: 2026-10-23
---

# Dividend yields are read off B3's option strike adjustments in COTAHIST, no new source (#81, amends 0013, 0017, 0054)

## Context

The engine prices options with a continuous dividend yield `q` (ADR-0013 "Rates, time and
greeks") read from `MarketView.dividendYields`, and defaults it to 0 with a
`dividend_yield_defaulted` note when none is visible. No loader ever filled that collection, so
every option price, implied volatility and greek in the app has used `q = 0`. For a high payer
that is a material bias: for a stock yielding 10% a year (PETR4 and VALE3 paid around that in
2024 and 2025), `q = 0` overprices a three-month at-the-money call at 30% volatility by about a
fifth of its premium.

ADR-0054 left this half of #81 open because a per-stock dividend source looked paid-only:
brapi's dividend data needs its Startup plan (ADR-0052's table), B3's listed-companies JSON is an
undocumented site backend ADR-0052 rejected as scraping, and CVM open data has no structured
per-share distribution with an ex-date (its FRE dividend table is yearly and late).

B3 itself publishes the needed fact in a file we already ingest. On a cash distribution's ex-date
(dividend, JCP or income), B3 lowers the strike of every listed option on the underlying by the
distribution's amount, rounded to the cent, so the option holder is neither helped nor hurt by the
price drop. COTAHIST carries each series' strike every session (`PREEXE`), so the distribution
shows up as the same drop in reais across every series that COTAHIST lists on both the session
before and the ex-date. A split or a bonus scales strikes instead, so its drops differ from strike
to strike.

Checked on COTAHIST_A2024, A2025 and A2026 (through October), comparing each listed series'
strike on consecutive sessions:

- 2024: 334 of 366 (root, session) groups with a strike change agree on a single drop across
  every series. Examples: VALE R$ 2,74 on 2024-03-12 (451 series), PETR R$ 1,13 on 2024-04-26,
  ABEV R$ 0,63 on 2024-12-20, ITUB R$ 0,02 every month (its monthly JCP).
- Every group that did not agree was a known factor event or two share classes under one root:
  BBAS's 2-for-1 split on 2024-04-16 (drops from 25,46 to 28,46, 2% agreement), GGBR, CMIG and
  KLBN bonuses, ITUB's 10% bonus on 2025-03-18, MGLU's reverse split (strikes rose), and BBDC3
  against BBDC4 or ELET3 against ELET6, which the registry's underlying separates.
- 2025 and 2026 show the same pattern (PETR R$ 0,73 on 2025-04-17, VALE R$ 1,76 on 2026-08-12).

## Decision

**A new session-bound source, `dividends`, detects cash distributions from stored option prices**
(`cash-distributions-source.ts`), right after `instruments`. For a session `D` and the session
before it, `P`:

1. It pends until `cotahist` has succeeded on both `D` and `P` and `instruments` on `D`
   (the registry maps a series to its underlying). The calendar's first session is terminal with
   zero rows.
2. `strikeTransitionsBetween` returns every physically settled series COTAHIST lists on both
   sessions, keyed by `(ticker, expiry, right)`, whose strike differs, with its registry
   underlying. Index options are cash-settled in points and never adjusted.
3. `detectCashDistributions` (pure) groups the transitions by underlying and keeps an underlying
   only when it has at least two distinct previous strikes, at least 90% of its transitions drop
   by the same amount, and that amount is positive. Two distinct strikes are what tells an equal
   drop from a proportional one; 90% tolerates a stray series. An underlying with a non-neutral
   corporate-action factor ex-dated on `D` is skipped: its strikes moved by both events at once.
4. Each detection is upserted into `cash_distributions` by `(underlying, ex_date)`: `amount` in
   reais per share as of the ex-date, `as_of` the ex-date session's close (when COTAHIST first
   shows the lowered strikes), `series_count`, and a `detected_at` write stamp that moves only
   when `amount` or `as_of` changes.

Only consecutive sessions count. A series that skipped the ex-date and reappears later shows the
drop on a later session, and often a sum of two distributions; comparing against the series'
last earlier sighting instead would detect the same distribution again weeks later.

The recent window (`gaps`, ten sessions) always runs. The rest of the history is a one-time
backfill (`succeededSessionsMissingRun(["cotahist", "instruments"], "dividends")`), newest first,
that stops starting new sessions at 15% of the route's `maxDuration`: each session is three
small queries, and the backfill must never cost `indexes`, `sgs` or `iv_index` their budget.
Like `iv_index`, `dividends` is derived data: its errors stay out of `ingest().ok`, and its
backfill's deferrals are not nightly trouble.

**The yield is derived when a view is loaded, not stored** (`dividend-yield.ts`,
`dividendYieldsForCandles` in `market-view.ts`). At each D1 candle's close:

```
annualYield = Σ amount × Π factor / close
```

over the distributions ex-dated after the same calendar date one year earlier and on or before
the session, each restated per share of the session by the corporate-action factors ex-dated
after it (a 2-for-1 split halves an earlier per-share amount). The engine converts it to
`q = ln(1 + annualYield)` as before. The point's `asOf` is the candle's: a distribution is
visible from its ex-date's close, the same instant as that session's candle, so no point sees a
distribution before COTAHIST published it.

An underlying gets points only from its first distribution ever detected. Before it, the engine's
own default (q = 0 with its note) is the same number; from it on, every session gets a point, a
zero one included, so a positive yield never stays visible after its distributions age out of the
window. "Ever" is read over the whole table, not the rows a view loaded, so the same session gets
the same point whatever window loaded it.

`loadMarketView` fills the collection when the engine's `DataWindow` asks for it (it always
does); `buildOperationMarketView` fills it for its own underlying (not for `extraInstruments`);
the asset reading and the radar fill it for their ticker. Each view folds the latest `detected_at`
of every distribution of its tickers ex-dated through its last session into `dataVersion`, for
the reason ADR-0054 folds `computed_at`: a backfilled distribution carries a past `as_of`.

**The IV index keeps `q = 0`.** `buildIvIndexMarketView` does not load yields. Its points are
stored and compared across a year by `iv_rank` (ADR-0051), so switching `q` on mid-history would
put a step into every high payer's series. Recomputing it with yields means marking every point
stale (ADR-0054 #275 addendum) and draining a full recompute; that is a separate decision, filed
as a follow-up.

## Consequences

- Option pricing, implied volatility and greeks in backtests, evaluations, the operation builder,
  the portfolio, the radar and suggestions use the underlying's trailing yield instead of 0 once
  its distributions are detected. A backtest's numbers change for high payers; nothing about how a
  run is chunked or resumed changes.
- Coverage is limited to optionable underlyings, which are the only ones whose `q` the engine
  reads. A stock without listed options keeps `dividend_yield_defaulted`.
- Coverage is limited in time by the registry: a series maps to its underlying only through
  `option_series`, and B3's registry file is downloadable only about twelve months back (checked:
  2025-10-15 answers, 2025-04-17 is empty). Sessions before the registry history the app holds
  detect nothing, and the first twelve months after it understate the trailing sum.
- Amounts are what B3 applied to strikes, rounded to the cent: Itaú's monthly R$ 0,01765 gross
  JCP is read as R$ 0,02, about 0,03 percentage point of yield a year. Where B3 adjusts by gross
  or net JCP, the strike adjustment is the drop the option market itself prices.
- A distribution too small to move a strike by a cent, or one on an underlying with fewer than two
  distinct strikes listed on both sessions, is missed. A distribution ex-dated on the same session
  as a recorded factor is skipped by design. A distribution is never deleted: one detected wrongly
  would stay until corrected by hand, which none of the 2024–2026 checks above needed.
- An unrecorded bonus whose drops happen to agree across every strike (only possible when every
  listed strike rounds to the same drop) would read as a distribution. The 2024–2026 files had
  none.
- ADR-0013's "publication time for dividend yields" is the close of the session a point is
  computed at. ADR-0017's source table gains `dividends`. ADR-0054's "dividend yields need a
  per-stock licensed source" is superseded. brapi stays the candidate for #24, not for this.
