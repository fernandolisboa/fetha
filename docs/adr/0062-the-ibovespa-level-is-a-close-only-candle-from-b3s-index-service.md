---
status: accepted
date: 2026-10-13
---

# The Ibovespa level is a close-only candle under `IBOV11`, read nightly from B3's index service, with cash-settled index options represented in the portfolio (#307, amends 0007, 0017, 0054)

## Context

COTAHIST carries no index row, so the app has no Ibovespa level: index options (`IBOVA183`,
market types 070/080, registry category `OPTION ON INDEX`) are ingested with their underlying set
to `IBOV11` — the asset code B3's own registry assigns to the index (`Asst` column) — yet nothing
prices them, `IBOV11` cannot be followed (`addToWatchlistAction` needs a candle), the series page
has no underlying to link to, the IV index skips it and the market bar's slot stays empty.

Bacen SGS series 7 stopped in 2019. The only free source is B3's index statistics service,
`https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay/<base64
of {"index":"IBOV","language":"pt-br","year":"YYYY"}>`: one JSON document per index and year, a
31-row day-of-month table with one string column per month in Brazilian number format, `null` on
non-sessions and on days not yet published, `results: null` for an unknown year. Verified on
2026-10-13: it answered every session through the last closed one and not the open one. B3's
Market Data policy v3.0.4 §7.9 and §7.10 allow end-of-day and historical data to be redistributed
free without prior authorisation; its paid index services (§7.3) cover real-time and delayed
intraday display, which this never does — the same footing COTAHIST stands on, a public B3 data
service rather than a market-data platform licence. `sistemaswebb3-listados.b3.com.br` has no
`robots.txt` restriction. The owner approved the source on 2026-10-13.

ADR-0063 already gave index options a `priceFactor` and a `settlementStyle` so a premium stored in
reais per contract can be compared with a spot and strike stored in points. This ADR ships the
level `priceFactor` needs a spot for, and wires the portfolio side of `settlementStyle: "cash"`
that ADR-0063 defined but left for the PR that first sets it from the registry.

## Decision

**Which tickers are market indexes is a code constant**, `market-data/market-index.ts`
(`marketIndexes`: `IBOV11`, its B3 service code `IBOV`, label and search aliases), client-safe
like `exchange-rate-match.ts`, not a database column: one entry today, the Ibovespa, read at a
handful of edges in `apps/web`, none in the engine. Membership-as-constant rather than a
`is_index` column keeps the schema honest (a market index is not an instrument — see
`UBIQUITOUS_LANGUAGE.md`) while letting every reader that already branches on a ticker (search,
the watchlist, the asset page, the nightly universe) ask `isMarketIndex(ticker)` instead of
joining a new table.

**The level is stored in `candles`**, ticker `IBOV11` (the registry's own key for the index, the
value every `option_series.underlying` join already carries; `IBOV` is the service's own request
code, used only in the fetch URL), timeframe `1d`, `open = high = low = close`,
`traded_quantity = 0`, `as_of` the session's close from `trading_sessions` — a B3 session value,
stamped like the session's stock candles, unlike PTAX's fixed publication instant (ADR-0061). Four
equal prices are a close repeated, not fabricated highs and lows, and nothing reads them as a
range (below). A table of its own was rejected: the engine resolves an underlying's spot from a D1
`Candle` and from nothing else, so every reader that needs IBOV11's spot would have had to
synthesise the same candle at read time instead of this one write doing it once.

Three refusals read `isMarketIndex`, all in `apps/web`, none in the engine:

1. **A stock leg on an index is refused**: the operation builder's leg validation
   (`validate-legs.ts`, reason `index_stock_leg`) and a stock fill in the portfolio
   (`portfolio-actions.ts`). The engine's own refusal of a stock fill on a zero-volume candle is
   defence in depth, not the rule a market index's real absence of shares relies on.
2. **Indexes are not in any evaluated or backtested universe**: `startRecipeAction`
   (`modules/recipes/actions.ts`) refuses one before any write, the nightly evaluation drops them
   from the watchlist's tickers (`evaluate-signals.ts`) before scanning for signals, and a
   backtest cannot name one (`startBacktestRun`, `modules/backtests/start-run.ts`, reason
   `index_in_universe`). This is what keeps ATR, high/low and `tradedQuantity` _strategy
   conditions_ from ever reading the synthetic fields an index candle carries — the asset page's
   own reading (item 3) is a separate code path and needed its own fix. An index-option-only
   strategy is a later product decision, not a side effect of this one. The radar (ADR-0066)
   excludes `IBOV11` from its universe the same way, once it has a candle: `radarUniverse`
   (`modules/market-data/radar-view.ts`) filters `isMarketIndex` so the index itself, which
   trades no options on itself, never occupies a radar slot.
3. **The level is shown in points (`209.066,90`), never with `R$`**: the instrument page, the
   watchlist, the market bar. The page draws a line (`RateLineChart`, ADR-0061) instead of
   candles, hides the nominal/adjusted toggle, the recipes panel and the CVM filings and sentiment
   panels (ADR-0060/ADR-0065 map companies, not indexes), and its own reading panel formats the
   SMA levels in points and drops the ATR/range row outright — ATR reads an index candle's
   synthetic high/low, so "daily range" has no meaning there. A watchlist row for an index is
   excluded wherever the watchlist feeds a strategy, a backtest or the radar, the same exclusion
   as item 2 — the watchlist itself may still hold one, for following.

Search finds it by prefix (`ibov`, the ticker's own prefix) and by alias (`ibovespa`), both
expanded inside `searchInstruments` so the command palette and the watchlist combobox share one
result and the alias never duplicates the plain prefix hit.

A thesis claim on `IBOV11` is now scorable, in points, through the view's `extraInstruments`.

**A new session-bound source, `indexes`**, runs after `instruments` and before `sgs` — not last
like `ptax` — because `iv_index` lists the underlyings it computes from the candles present on the
session and never revisits a skipped underlying once the session succeeded (ADR-0054 §4): an index
landing after `iv_index` would lose `IBOV11`'s point for that session for good. Each year's
document is fetched at most once per invocation (success or failure memoised), with the SGS 15 s
timeout and one retry, so a stalled B3 costs at most about 31 s per calendar year touched;
normally one request of about 10 KB. Older gap sessions stop starting at 40% of `maxDurationMs`
(`INDEXES_START_BUDGET_FRACTION`), the newest at `iv_index`'s own 60% hard stop — the split `sgs`
uses (#298). Each session writes cumulatively from the day after the latest stored `IBOV11`
candle (first ever: `SGS_DEFAULT_SINCE`, 2024-01-01, so the whole 2024..today history lands on the
first night and no backfill queue exists, unlike `iv_index`). A published date with no trading
session is skipped and counted (`skippedRows`). The processed session's own date missing from the
document is `pending` on the newest gap session (rows for earlier dates are still written, no
succeeded marker) and a failure on an older one, exactly `sgs`'s rule (#216); `results: null` for
the current year's first days is the same `pending`. Candles are written inside
`withSourceLock("cotahist")`: every writer of `candles` goes through that lock so the calendar
delete's probe is never interleaved with a write (ADR-0017, #189). An `indexes` error flips
`ingest().ok` like `sgs` and `ptax`; evaluation still gates on `cotahist` alone; a deferral is
unsurfaced trouble for the owner's manual run, like `ptax`'s.

**`iv_index` waits for `indexes` on every session it is responsible for, deferred or failed
alike** (ADR-0054 addendum): `indexesMissing` is every session `indexes` has ever had outstanding
(`gaps(db, "indexes", now)`) minus the ones that succeeded this run, not only the ones this run's
own start budget got around to starting — so a session `indexes` never even attempted (its start
budget elapsed first, or it sits outside `iv_index`'s own backfill window this run) pends
`iv_index` for it exactly like one `indexes` attempted and failed. A late or never-started B3
index document delays every underlying's point by one cron — the shape the CDI gate already has —
instead of silently dropping `IBOV11`'s.

**Index options' cash settlement, wired into the portfolio** (the follow-up ADR-0063 named): a
cash-settled leg's `LegSettlement.cashSettlementValue` (centavos, signed, null for a
physically-settled leg) never produces the stock fill a physical exercise/assignment does — there
is no Ibovespa to deliver. `settlement-plan.ts`'s closing option fill is instead priced at
`|cashSettlementValue| / 100 / quantity` (reais per contract), its side already the leg's opposite
so `bookkeeping.ts`'s existing sign-by-side logic gives the cash flow the right direction with no
new code there. The user's own settlement costs (`LegChoice.costsCentavos`), which a
physically-settled leg always carries on its stock fill, have nowhere else to land for a
cash-settled leg (it produces none) and are now put on that same closing option fill instead of
being validated and discarded.

**Rejected: store the index and index strikes already divided by `priceFactor`** (ADR-0063's own
rejection, restated here for the level itself). It would keep every number on one scale, but
rewrites `option_series.strike`'s point-in-time history (ADR-0056), reverses ADR-0017's tested
strike rule, and makes every stored number, AI input and journal entry read 1/100 of what B3 and
the owner call the Ibovespa.

## Consequences

- `IBOV11` is reference data in `candles`, read-only, no isolation test (CLAUDE.md principle 5).
- The market bar shows `IBOV 209.066,90` beside `USD/BRL`, loaded in the shell layout, fail-soft.
- `IBOV11`'s IV index history starts the first night the candle and a not-yet-succeeded `iv_index`
  session coincide; an `iv_rank` on it needs its lookback in nights, as ADR-0051 already accepts.
- B3's publication time is not pinned (observed: absent during the session, present for every
  closed one); all three crons run after the close and `pending` covers a late document.
- Known limitations: B3's index-option tariff is not modelled (ADR-0040's equity-option rate would
  apply to a decision's cost model on an index structure; no backtest can reach one, by item 2
  above); a wrong index value is corrected by re-ingestion, like a macro point; only `IBOV` is read
  — another index is a new entry in the constant and a request per year, not a design change.
  Cash settlement is booked against `IBOV11`'s daily close, while B3 settles an expiring index
  option against its own settlement index for that expiry (an intraday average); the booked
  amount can differ from the broker statement. `indexes` writes cumulatively from the day after
  the latest stored `IBOV11` candle: a value B3 revises later, or a session that was `null` when
  a later one had already been published, is never re-read on its own — correcting it means
  deleting that candle row and re-running.
- Sources enumerated by name (`freshness.ts`, the nightly report, the manual panel) pick up
  `indexes` from `ingestionSourceValues` unchanged.
- The instruments registry parser (ADR-0063) now refuses an `OPTION ON INDEX` row with a blank,
  unparsable or non-positive `PricFctr` instead of ever defaulting it to 1 — a cash-settled series
  mispriced 100x is worse than one dropped and retried the next run.
