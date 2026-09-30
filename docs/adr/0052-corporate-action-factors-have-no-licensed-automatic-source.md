---
status: accepted
date: 2026-09-29
---

# Corporate-action factors are entered by the owner; no licensed automatic source yet (#50)

## Context

#50 asks the nightly job to record `corporate_action_factors` (splits, reverse splits and stock
bonuses as `previous/current` ratios, `asOf` at the ex-date session open, ADR-0013) from a
documented licensed or public source. Everything downstream of the source already exists: the
table and its repository (`market-data/repositories/corporate-action-repository.ts`), the market
view loader, and the engine's adjusted series, which multiplies every session before the ex-date
by the factors visible at the evaluated instant and scales `tradedQuantity` accordingly
(`buildCandleSeries`, covered by `candle-series.test.ts` and `candle-series.integration.test.ts`).
Only the writer is missing, and #69 (option series rollover across a corporate action) waits on
it. Until factors exist, every backtest and indicator over a split reads the event as a price jump:
a 2-for-1 split looks like a 50% crash to an SMA, a stop loss and a drawdown.

Sources evaluated on 2026-09-29 (reachability tested from a cloud session):

| Source                                              | Carries ratio and date                                                                                                               | Terms                                                                                                                                                                                                        | Verdict              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| COTAHIST (`DISMES`, `FATCOT`)                       | No: `DISMES` counts distributions (COTAHIST layout), `FATCOT` is a quotation lot (ADR-0017)                                          | public file                                                                                                                                                                                                  | cannot give a ratio  |
| B3 instruments registry and other public B3 files   | No corporate-events file                                                                                                             | public file                                                                                                                                                                                                  | nothing to read      |
| B3 listed-companies JSON (`sistemaswebb3-listados`) | Yes (`stockDividends`: label, factor, last date prior)                                                                               | undocumented site backend; B3's terms of use forbid redistribution without consent                                                                                                                           | not usable: scraping |
| CVM open data (`dados.cvm.gov.br`)                  | No split/grouping/bonus dataset (buybacks only)                                                                                      | open licence                                                                                                                                                                                                 | nothing to read      |
| brapi.dev `quote?dividends=true`                    | Yes: the B3 `stockDividends` records (`label` DESDOBRAMENTO / GRUPAMENTO / BONIFICACAO, `factor`, `completeFactor`, `lastDatePrior`) | documented API, commercial use allowed; without a token only the four test tickers answer; dividends need the Startup plan (R$ 124,92/month, or R$ 99,99/month billed yearly, at the time of writing) or Pro | usable, paid         |

Without a token, brapi answers only its four test tickers (PETR4, VALE3, ITUB4, MGLU3, dividends
included); BBAS3, WEGE3, TAEE11 and ABEV3 return `MISSING_TOKEN` (checked 2026-09-29). A real
brapi response for PETR4 holds the 2008 2-for-1 split (`factor` 2,
`lastDatePrior` 2008-04-25), the 2000 1-for-100 grouping (`factor` 0.01) and a 1994 bonus
(`factor` 1.3333334); a factor in this repo's convention is the inverse (`0.5`, `100`, `0.75`).

## Options considered

Nothing is written to `corporate_action_factors` by the app until the owner picks a source.
The options, and what each would build:

1. **brapi, one app-level key for corporate actions only.** A `BRAPI_REFERENCE_TOKEN` server env
   var (distinct from the `BRAPI_TOKEN` placeholder in `.env.example`, which stays with ADR-0007's
   per-user tier) on a Startup subscription the owner pays for (R$ 100 to 125 a month); a nightly
   adapter (`adapters/brapi-corporate-actions/`) fetches `stockDividends` for every cash-equity
   ticker in the instruments registry, like the rest of the reference data, converts `factor` to
   `1 / factor`, takes the ex-date as the first trading session after `lastDatePrior`, and upserts
   by `(ticker, ex_date)`. A few hundred tickers a night stay well inside the plan's monthly
   requests. This reopens the option ADR-0007 rejected ("one app-level provider key with a shared
   cache") for this one data class: ADR-0007 parked it because brapi does not publish whether a
   paid account may serve its data to other users. A ratio is a public fact every company files,
   not the quotes that rule protects, but the precondition stands: before paying, the owner
   confirms with brapi that a Startup account may store the ratios and use them for every
   account of the app. Recommended: automatic, and the subscription plus that one confirmation
   are the only owner steps.
2. **Owner-entered factors.** An owner-only form on /configuracoes (ADR-0042's owner gate) where
   the owner types a ticker, ex-date and "N para M" from the company's public notice. Free, but a
   manual step per event, and a missed notice leaves the series wrong.
3. **Keep #50 deferred.** Backtests and indicators keep reading splits as price jumps.

## Decision (2026-09-30)

Option 2 is in force: an owner-only form on `/configuracoes` (ADR-0042's `isOwner()` gate), not
brapi. The owner scheduled #50 for 2026-09-30 and chose the free option because a brapi adapter
needs his own paid Startup subscription, which he has not taken yet; option 1 stays open and would
add a `brapi-corporate-actions` adapter beside this form, not replace it, the day he does.

`recordCorporateActionFactorAction` re-checks `isOwner()` server-side, refuses an ex-date that is
not a trading session in the calendar (the calendar only carries sessions from
`FIRST_INGESTED_CALENDAR_YEAR`, 2024, on, so an older real event is refused the same way a
non-trading date is) or a ticker with no stored daily candle, and upserts by
`(ticker, ex_date)`: re-submitting the same pair corrects a mistaken factor. **There is
deliberately no delete.** A deleted row could never move `MarketView.dataVersion` (nothing would
be left to carry a fresher stamp), so a chunked backtest resumed after a deletion could silently
keep reading the pre-deletion view; entering `1` `para` `1` for the same ticker and ex-date is how
the owner neutralizes a mistaken entry instead.

**A `1` row still has to disappear from what the engine sees.** The engine's own stale-price
suppression (`suppressStaleImpliedVolatility`,
`packages/engine/src/internal/price-operation.ts`) only asks whether _some_ factor exists with
`exDate` in range — it does not look at the factor's value — so a neutralizing `1` row left in
`MarketView.corporateActions` would still suppress IV/greeks on a stale option leg around that
ex-date, the opposite of "neutralize". Market-data therefore filters `factor = 1` rows out of
every `corporateActions` collection it ever hands the engine (`loadMarketView`,
`buildOperationMarketView`, `loadCandleSeries`), while keeping the row itself, `asOf` and all, in
storage: its `recordedAt` still has to move `dataVersion` (below), so the neutralizing write still
fails a chunked run in progress the same way any other correction does.

**`recorded_at`, not `as_of`, is what has to move `dataVersion`.** The owner can type or correct a
factor for a long-past ex-date at any time, so `as_of` (that ex-date session's own open, fixed by
ADR-0013 regardless of when the row is written) can already sit inside a window a chunked backtest
loaded before the correction landed. Migration 0032 adds `corporate_action_factors.recorded_at`
(`timestamptz`, `default now()`, bumped by the database clock whenever the upsert changes the stored
`(factor, as_of)`; an identical resubmission is a no-op and moves nothing) and
`loadMarketView`'s `dataVersion` folds it in alongside every collection's own `as_of`, exactly the
way ADR-0054 folds `implied_volatility_index.computed_at` in for the same reason: a resumed run
that would otherwise mix a pre- and post-correction view instead fails with
`data_version_changed`.

## Consequences

- #69 stays deferred until enough factors are recorded to matter for option-series rollover.
- ADR-0004's and ADR-0017's statements that no source writes the table are superseded: the owner
  does, through `/configuracoes`.
- A missed or late notice still leaves the series reading a split as a price jump until the owner
  enters it; nothing catches a corporate action the owner never noticed.
- Reopening option 1 later adds an adapter; it does not remove this form, which stays the
  correction path for anything the adapter gets wrong or a ticker it does not cover.
- **`recorded_at` is a deliberate wall-clock stamp in `dataVersion`**, the same choice ADR-0054
  made for `implied_volatility_index.computed_at`. This departs from the reasoning ADR-0013's #90
  addendum gives for keeping wall-clock stamps (a session's own `as_of`) out of `dataVersion`: a
  write-time stamp can mask a same-day candle landing after it (a `dataVersion` that already moved
  for the correction hides a later, unrelated ingestion inside the same window), and it is what the
  nightly report's "Dados até" provenance would show as the freshness of a run that only recorded a
  factor, not new market data. Both are accepted consequences, not oversights: without folding in
  `recorded_at`, the regression migration 0032 exists for (a corrected past-dated factor never
  moving `dataVersion`) would still be open.
