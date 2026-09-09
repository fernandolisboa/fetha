---
status: accepted
date: 2026-09-09
---

# Reference data ingestion: sources, partitioning, retries, freshness, adjustment

This ADR records the operational shape of the nightly ingestion job (#12): four adapters behind
`MarketDataProvider` (ADR-0007), monthly-partitioned storage for the two time-series tables,
idempotent upserts, a three-attempt retry schedule, and what "freshness" and "adjusted" mean for
this data.

## Sources and natural keys

| source               | adapter (`apps/web/src/modules/market-data/adapters/`) | natural key                                                               | cadence                                 |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------- |
| COTAHIST             | `cotahist`                                             | `(ticker, timeframe, session)` candles; `(ticker, session)` option prices | one daily file per session              |
| Instruments registry | `b3-instruments`                                       | `(ticker)` option series                                                  | fetched "for today" every run           |
| Bacen SGS            | `bacen-sgs`                                            | `(series, date)` macro points                                             | incremental since the last stored point |
| ANBIMA calendar      | `anbima-calendar`                                      | `(date)` trading sessions                                                 | once per calendar year                  |

Every write is an `INSERT ... ON CONFLICT (natural key) DO UPDATE`, so re-ingesting the same file
twice changes nothing (tested: `ingest.integration.test.ts`, "is idempotent"). `ingestion_runs`
records one row per `(source, session)` attempt with `status`, `startedAt`/`finishedAt`,
`rowCount` and `error`; a retry that finds a `succeeded` row for the same `(source, session)`
skips the fetch entirely rather than re-running it (`findSucceededRun`,
`repositories/ingestion-run-repository.ts`) — the no-op a retry is supposed to be.

The instruments registry and COTAHIST both key ingestion runs on the target trading session (the
same date passed to `ingest()`); the calendar keys on a `{year}-01-01` marker session, since a
calendar ingestion covers a whole year, not one trading session.

## COTAHIST parser (`adapters/cotahist/parser.ts`)

Fixed-width, 245 bytes/record, 1-based inclusive positions per the B3 layout: `TIPREG` (1-2),
`DATA` (3-10), `CODBDI` (11-12), `CODNEG` (13-24), `TPMERC` (25-27), ..., `PREABE`/`PREMAX`/
`PREMIN`/`PREMED`/`PREULT` (57-121, 13 digits each, 2 implied decimals), `TOTNEG` (148-152),
`QUATOT` (153-170), `PREEXE` (189-201, strike), `DATVEN` (203-210, expiry), `FATCOT` (211-217,
quotation-lot factor). Record type `00`/`99` (header/trailer) are skipped; `01` is parsed.
`TPMERC = "010"` is treated as a cash-market stock/ETF row; `"070"`/`"080"` are call/put option
rows. `FATCOT` divides every price field on the row (a lot-grouping factor, e.g. `1000` for
some BDRs), not a corporate-action adjustment — see "What adjustment covers" below.

## Instruments registry parser (`adapters/b3-instruments/parser.ts`)

Semicolon CSV; only rows whose `CFICode` (ISO 10962) starts `OC`/`OP` (call/put option) are kept,
giving `underlying`, `strike`, `expiry` and `style` (`OptnStyle` `A`/`E`) per series. Every other
row (stocks, ETFs, ...) is skipped: candles come from COTAHIST.

## Bacen SGS windowing and annualization (`adapters/bacen-sgs/`)

The API enforces a 10-year window per request (as of March 2025); `splitIntoTenYearWindows`
chunks any longer span into consecutive ≤10-year windows and one request is issued per window.
Series 12 (CDI, % a.d.) and 433 (IPCA, % a.m.) are compounded to an annual rate
(`(1 + r/100)^periods - 1`, 252 sessions or 12 months); series 432 (Selic meta/target, already
% a.a.) passes through unchanged. Series 11 (Selic efetiva, % a.d.) is fetched by no adapter
today: the engine's `MacroPoint` has one `annualRate` slot per kind (`cdi`/`selic`/`ipca`), and
432 already gives the annual Selic rate without a compounding assumption, so 11 is redundant for
this ticket's scope — a documented gap, not an oversight.

## ANBIMA calendar (`adapters/anbima-calendar/`)

Every weekday not in the holiday file is a full trading session: open `13:00Z`
(10:00 America/Sao_Paulo), close `20:00Z` (17:00 America/Sao_Paulo). **Simplifying assumption**:
B3's documented half-day sessions (Ash Wednesday afternoon, Dec 24/31 shortened hours) are not
modeled; every generated session has the regular full-day open/close. This is acceptable for a
personal, non-execution tool and is called out here so a future ticket can add the exceptions
without silently changing already-ingested `asOf` values.

## Monthly partitioning

`candles` and `option_daily_prices` are `PARTITION BY RANGE (session)` parents
(`drizzle/0001_market_data_reference_tables.sql`); `create_monthly_partitions(parent, start, end)`
is a Postgres function, idempotent (`CREATE TABLE IF NOT EXISTS ... PARTITION OF`), that creates
one partition per calendar month in `[start, end)`. The migration seeds partitions for 2024-01
through 2026-12; `ensureMonthlyPartition` (`repositories/partitions.ts`) calls the same function
for the ingested session's month before every write, so a new month is created on first use and
never needs its own migration (tested: `partitions.integration.test.ts`, which also proves the
function creates a partition for a month outside the migration's initial window). `drizzle-kit`
has no notion of native partitioning, so `candles`/`option_daily_prices` are declared as ordinary
tables in `src/db/schema/market-data.ts` for the query builder's types; the migration SQL turns
them into partitioned parents by hand, edited after `drizzle-kit generate`.

## Retry schedule (ADR-0010)

22:00 America/Sao_Paulo plus 00:30 and 06:00 → 01:00, 03:30, 09:00 UTC (`apps/web/vercel.json`,
three cron entries, no DST in Brazil since 2019). Every entry hits the same bearer-protected
`GET /api/cron/ingest`; a run that finds the target session already `succeeded` per source is a
no-op (above), so the second and third crons cost nothing beyond one query per source when the
first attempt already finished cleanly.

## Manual trigger

The same route accepts `POST` with the bearer and an optional JSON body `{ "session": "YYYY-MM-DD" }`
to re-run a specific session (for Playwright and for the owner). A malformed `session` returns
`400` before touching the database; the bearer check is identical to `GET` and is the only rate
limit (the secret is never logged or echoed).

## Freshness

`market-data` exposes `latestSession(db, at)` (the most recent trading session with `close <= at`)
and `freshness(db)` (the latest recorded `ingestion_runs` row per source, whatever its status) —
the two functions #13's market bar reads (`freshness.ts`).

## What adjustment covers, and what it does not (ADR-0004)

COTAHIST prices are **not adjusted for corporate actions** and the file **includes delisted
instruments** (survivorship-neutral, not survivorship-bias-free by omission). This ticket records
`corporate_action_factors` rows only when `FATCOT` (the quotation-lot factor) changes between two
consecutive sessions for the same ticker (`detectFatcotFactorChanges`,
`adapters/cotahist/detect-factor-changes.ts`) — a re-basing of the quoted price scale (e.g. after
a bonus issue that changes the quoted lot), **not** the same thing as a stock split or a dividend.
**Dividends are not covered**: COTAHIST never reflects them as a `FATCOT` change, and no source
this ticket adds carries dividend data. `detectFatcotFactorChanges` is implemented and unit-tested
but is not yet wired into `ingest()` (it needs the previous session's per-ticker factors, which
means either persisting them or re-reading yesterday's file — left as a fix-forward candidate
rather than adding a second network fetch to every ingestion run for a case this dataset cannot
fully answer anyway). `corporate_action_factors.asOf` is defined as the ex-date session's open per
ADR-0013, whenever a factor is recorded by any future extension of this mechanism.

## Considered options

- **Deriving corporate-action factors from `PREULT`/`PREABE` jumps**: rejected; a same-magnitude
  price jump is indistinguishable from ordinary volatility without a labeled event, and would
  produce false adjustments more often than `FATCOT`, which is at least an explicit, labeled field.
- **A dedicated dividend feed in this ticket**: out of scope; no free, redistributable dividend
  source was confirmed during research (docs/research/2026-09-02-market-data-providers.md); adding
  one is a separate ticket once a source is confirmed.
- **Half-day sessions modeled from day one**: deferred; the exceptions are few and dated, and
  getting the boundary instants right (are half-day intraday candles still ingested?) is more
  ADR than this ticket's scope, hence the documented simplification above.
