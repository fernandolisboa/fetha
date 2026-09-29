---
status: proposed
date: 2026-09-29
---

# Corporate-action factors have no free, licensed automatic source yet (#50)

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

| Source                                              | Carries ratio and date                                                                                                               | Terms                                                                                                                                                     | Verdict              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| COTAHIST (`DISMES`, `FATCOT`)                       | No: `DISMES` counts distributions, `FATCOT` is a quotation lot (ADR-0017)                                                            | public file                                                                                                                                               | cannot give a ratio  |
| B3 instruments registry and other public B3 files   | No corporate-events file                                                                                                             | public file                                                                                                                                               | nothing to read      |
| B3 listed-companies JSON (`sistemaswebb3-listados`) | Yes (`stockDividends`: label, factor, last date prior)                                                                               | undocumented site backend; B3's terms of use forbid redistribution without consent                                                                        | not usable: scraping |
| CVM open data (`dados.cvm.gov.br`)                  | No split/grouping/bonus dataset (buybacks only)                                                                                      | open licence                                                                                                                                              | nothing to read      |
| brapi.dev `quote?dividends=true`                    | Yes: the B3 `stockDividends` records (`label` DESDOBRAMENTO / GRUPAMENTO / BONIFICACAO, `factor`, `completeFactor`, `lastDatePrior`) | documented API, commercial use allowed; dividends need the Startup plan (R$ 124,92/month, or R$ 99,99/month billed yearly, at the time of writing) or Pro | usable, paid         |

A real brapi response for PETR4 (free test ticker) holds the 2008 2-for-1 split (`factor` 2,
`lastDatePrior` 2008-04-25), the 2000 1-for-100 grouping (`factor` 0.01) and a 1994 bonus
(`factor` 1.3333334); a factor in this repo's convention is the inverse (`0.5`, `100`, `0.75`).

## Decision (proposed, pending the owner)

Nothing is written to `corporate_action_factors` by the app until the owner picks a source.
The options, and what each would build:

1. **brapi, one app-level key for corporate actions only.** A `BRAPI_TOKEN` server env var on a
   Startup subscription the owner pays for (R$ 100 to 125 a month); a nightly adapter
   (`adapters/brapi-corporate-actions/`) fetches `stockDividends` for the tickers some user watches
   or holds, converts `factor` to `1 / factor`, takes the ex-date as the first trading session
   after `lastDatePrior`, and upserts by `(ticker, ex_date)`. This amends ADR-0007's rule that brapi data is fetched with each user's
   own token: corporate-action ratios are facts about an instrument, not the quotes the per-user
   rule protects. Recommended: automatic, and the recurring cost is the only owner step.
2. **Owner-entered factors.** An owner-only form on /configuracoes (ADR-0042's owner gate) where
   the owner types a ticker, ex-date and "N para M" from the company's public notice. Free, but a
   manual step per event, and a missed notice leaves the series wrong.
3. **Keep #50 deferred.** Backtests and indicators keep reading splits as price jumps.

## Consequences

- #69 stays deferred until factors are recorded.
- ADR-0004's and ADR-0017's statements that no source writes the table stay true until then.
