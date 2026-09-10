---
status: accepted
date: 2026-09-09
---

# Reference data ingestion: sources, partitioning, retries, freshness, adjustment

This ADR records the operational shape of the nightly ingestion job (#12): four sources, none of
them behind `MarketDataProvider` (that port is amended in ADR-0007 to be the per-user intraday
seam only; reference-data sources are fetch-and-parse functions private to `market-data`),
monthly-partitioned storage for the two time-series tables, idempotent upserts, a three-cron-a-day
retry schedule that drains every un-ingested session in a bounded window rather than pinning on
the latest or a single oldest one, and what "freshness" and "adjusted" mean for this data.

Real endpoints were verified against B3, ANBIMA and Bacen on 2026-09-09 (see "Sources and natural
keys" below); the review round that produced this revision downloaded real files for every source
and fixed fixtures and adapters to match them.

## Sources and natural keys

| source               | adapter (`apps/web/src/modules/market-data/adapters/`) | natural key                                                               | cadence                                       |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------- |
| COTAHIST             | `cotahist`                                             | `(ticker, timeframe, session)` candles; `(ticker, session)` option prices | one daily zip file per session                |
| Instruments registry | `b3-instruments`                                       | `(isin)` option series                                                    | fetched "for today" every run                 |
| Bacen SGS            | `bacen-sgs`                                            | `(series, date)` macro points                                             | incremental since the last stored point       |
| ANBIMA calendar      | `anbima-calendar`                                      | `(date)` trading sessions                                                 | committed once, re-ingested per calendar year |

Every write is an `INSERT ... ON CONFLICT (natural key) DO UPDATE`, so re-ingesting the same file
twice changes nothing (tested: `ingest.integration.test.ts`, "is idempotent", and
`repositories/upsert-idempotency.integration.test.ts` at the repository level). `ingestion_runs`
records one row per `(source, session)` attempt with `status`, `startedAt`/`finishedAt`,
`rowCount` and `error`; a retry that finds a `succeeded` row for the same `(source, session)`
skips the fetch entirely rather than re-running it (`findSucceededRun`,
`repositories/ingestion-run-repository.ts`) — the no-op a retry is supposed to be. A unique partial
index, `ingestion_runs (source, session) WHERE status = 'succeeded'`, makes "at most one succeeded
run per (source, session)" a database invariant, not just application discipline.
`ingestion_runs` itself is **shared, reference-class metadata**: no `user_id`, written only by the
ingestion job, and read by every user through `market-data.freshness()`/`gaps()`/`allGaps()` (the
market bar, #13) — a table users read but never write, distinct from `invites`/`mail_outbox`
(ADR-0016, written and read by the system alone). `data_version` was removed from the schema and
migration in this round of review; recording real corporate-action factors is #50, not this table.

Instruments and COTAHIST each pick **their own** target sessions per run: every un-succeeded
session in the last 10 closed trading sessions on or before `at` ("Session selection" below); the
calendar keys each year's ingestion on a marker session derived from that year's holiday list
("Session selection" below), since a calendar ingestion covers a whole year, not one trading
session.

## Session selection

The earlier version of this ticket targeted "the latest closed session" unconditionally: a session
that failed three retries in a row was silently skipped forever once the next session closed,
leaving a permanent hole. A later revision fixed that by targeting the single **oldest**
un-succeeded session in the window, but that in turn meant one permanently-failing session pinned
the source and no session after it ever got attempted. `ingest()` now drains **every** gap in the
window, oldest first, in one invocation: `market-data.gaps(db, source, at)` (`recentSessions`,
`repositories/calendar-repository.ts`, last 10 closed sessions on or before `at`) returns the full
un-succeeded list, and `runSessionBoundSource` (`ingest.ts`) attempts each one in turn, recording
its own `ingestion_runs` row and outcome; a session that keeps failing is retried every invocation
without blocking the sessions after it. If every session in the window has already succeeded, the
source is fully caught up and this run is a no-op for it. `allGaps(db, at)` exposes the same
per-source lists (typed `Record<Exclude<IngestionSource, "calendar">, string[]>`, since "calendar"
is keyed on a yearly marker, not one of these trading sessions) so the market bar (#13) can show a
source that has fallen behind. The manual `POST` trigger bypasses the search and targets the given
`session` directly.

The calendar's own marker session cannot be a fixed `{year}-01-01`: `ingestion_runs.session` is a
Postgres `date` column, but a fixed marker means a corrected ANBIMA source file or a newly added
B3 closure is never re-ingested, since the marker already has a `succeeded` row.
`calendarMarkerSession(year)` (`ingest.ts`) instead hashes that year's ANBIMA holidays plus B3's Dec
24 / Dec 31 closures and folds the hash into a day offset within `year`, so the marker date itself
changes whenever the underlying holiday list does, and stays a valid date.

## Bookkeeping: the lock does not wrap it

`runSource` (`ingest.ts`) inserts the `running` row and later updates it to `succeeded`/`failed`
using the plain `db` handle, not inside the advisory-lock transaction: only the fetch-plus-write
`run()` callback runs inside `withSourceLock`, re-checking for a `succeeded` row written by a
concurrent winner before doing the work. Committing the `running` row before acquiring the lock is
what makes it visible to `reapStaleRunningRuns` the moment a run starts; wrapping the row's insert
and its own status update in the same transaction as the lock (the earlier version) meant the row
was only ever visible to other transactions once it had _already_ moved off `running`, which made
the stale-run reaper permanently unreachable.

## COTAHIST parser (`adapters/cotahist/parser.ts`, `adapters/cotahist/fetch.ts`)

B3 serves the daily file as a ZIP (`COTAHIST_D{ddmmyyyy}.ZIP`) containing one latin1-encoded,
fixed-width `.TXT` member; `fetch.ts` decompresses it with `fflate` (`unzipSync`, pinned exact
version) and decodes with `TextDecoder("latin1")` before handing the text to the parser. Layout:
245 bytes/record, 1-based inclusive positions per the B3 spec: `TIPREG` (1-2), `DATA` (3-10),
`CODBDI` (11-12), `CODNEG` (13-24), `TPMERC` (25-27), ..., `PREABE`/`PREMAX`/`PREMIN`/`PREMED`/
`PREULT` (57-121, 13 digits each, 2 implied decimals), `TOTNEG` (148-152), `QUATOT` (153-170),
`PREEXE` (189-201, strike), `DATVEN` (203-210, expiry), `FATCOT` (211-217, quotation-lot factor).
Every record is asserted to be exactly 245 bytes; record type `00`/`99` (header/trailer) are
skipped, `01` is parsed, anything else throws. `TPMERC = "010"` is a cash-market stock/ETF row;
`"070"`/`"080"` are call/put option rows, which also carry `strike`, `expiry` and `right` so
`option_daily_prices` can persist them per session (previously only `option_series` had them).

Prices divide the raw integer cents by `100 x FATCOT` **once**, at full `decimal.js` precision
(`applyQuotationFactor`), then round to the storage scale (`numeric(18,6)`, widened from
`numeric(18,2)`); the earlier version rounded to 2 dp mid-calculation, which collapsed a
lot-quoted price (e.g. FATCOT 1000, raw cents 44) to `0.00` — fixed and covered by a regression
test on the real FNAM11 row (FATCOT 1000) from the 2026-09-08 COTAHIST file. `FATCOT` is a
lot-grouping factor, not a corporate-action adjustment — see "What adjustment covers" below.

**`PREEXE` (strike) divides by `100` only, never by `FATCOT`**: strike is always denominated in
raw cents or index points regardless of the traded lot size, unlike the price fields above.
Dividing it by `100 x FATCOT` (the earlier version's bug) silently shrank every option's strike by
the same factor as its price; the real 2026-09-08 IBOVA183 row proves the divisor is `100` alone —
raw `PREEXE` `18300000` / `100` = `183000`, exactly the instruments registry's `ExrcPric` for the
same series (`option_series.strike`), while `/ (100 x FATCOT)` with that day's `FATCOT` of `100`
gave the wrong `1830`. Covered by a cross-source consistency test against both real files.

Because `strike` and the price fields (`average`, `close`) are on different units for the same
index-option row — strike in raw points, prices in R$ per contract already divided by `FATCOT` —
`option_daily_prices.factor` persists the `FATCOT` used for that row's price fields, so a later
reader can tell the two columns apart instead of assuming a shared unit.

`fetchCotahist`/`parseCotahist` reject a file whose `DATA` field does not match the requested
session (`CotahistParseError`), so a stale or mismatched download fails loudly instead of silently
mis-dating every row it ingests.

## Instruments registry (`adapters/b3-instruments/fetch.ts`, `.../parser.ts`)

The documented single-URL SPA endpoint serves HTML, not CSV. The real flow, verified 2026-09-09,
is a two-step token exchange: `GET .../api/download/requestname?fileName=InstrumentsConsolidatedFile&date=YYYY-MM-DD&recaptchaToken=`
returns JSON with a `token`, then `GET .../api/download/?token=<token>` returns the CSV
(latin1, `;`-separated, first line `Status do Arquivo: Final`, header on the second line). The
real registry also lists ~7,400 commodity/FX option rows (`SctyCtgyNm` blank, `MktNm`
`OPTIONS ON FUTURE`/`OPTIONS ON SPOT`, e.g. `BGIF27C034000`) whose tickers don't fit `tickerSchema`
and are out of this ticket's scope; `SctyCtgyNm` is filtered to
`SHARES`/`BDR`/`ETF EQUITIES`/`ETF FOREIGN INDEX`/`OPTION ON EQUITIES`/`OPTION ON INDEX` **before**
any row is validated, so an out-of-scope row is a skip, not a thrown error that loses the whole
day's registry. Within the in-scope categories, rows with `OptnTp` `Call`/`Put` are kept; `OptnStyle`
maps `AMER`/`EURO` to `american`/`european`, `ExrcPric` has a comma decimal separator converted to
a dot, and the underlying comes from `Asst` (for an option row, `Asst` already carries the full
underlying ticker, e.g. `PETR4`, not just the root `PETR`). `ISIN` is kept and becomes
`option_series.isin`. Any remaining in-scope row that still fails validation is a counted skip
(logged), not a thrown error, for the same reason.

**Option series identity**: B3 reuses option tickers across listing cycles and adjusts strikes, so
`ticker` alone is not a stable natural key; `isin` is (`option_series.isin`, unique, primary key).
Upsert is keyed on `isin`; `ticker`, `underlying`, `right`, `strike`, `expiry` and `style` update on
every conflict, but `as_of` is set once on insert and only ever moves backward
(`LEAST(existing, excluded)`) on conflict — so a later run reprocessing an older registry snapshot
can never erase a newer `as_of` a previous run already recorded (ADR-0013 visibility depends on
`as_of` never advancing without cause).

## Bacen SGS windowing, annualization and asOf (`adapters/bacen-sgs/`)

The API enforces a 10-year window per request (as of March 2025); `splitIntoTenYearWindows` chunks
any longer span into consecutive ≤10-year windows, one request per window. **`annualRate` is
stored as a fraction, not a percent**: ADR-0013's `ln(1 + cdi)` consumes `0.14` for 14% a.a., not
`14.00`. Series 12 (CDI, % a.d.) is compounded to an annual fraction
(`(1 + r/100)^252 - 1`, e.g. a 0.05% a.d. rate compounds to `0.13424645`); series 432 (Selic
meta/target, % a.a.) and series **13522** (IPCA, 12-month accumulated, % a.a. — corrected from
annualizing the single-month series 433, which mixed a monthly print into a spot annual number the
engine cannot use as a trailing-12-month rate) both convert to a fraction with a plain `/ 100`, no
compounding. Series 11 (Selic efetiva, % a.d.) remains fetchable but unfetched: the engine's
`MacroPoint` has one `annualRate` slot per kind (`cdi`/`selic`/`ipca`) and 432 already gives the
annual Selic rate — a documented gap, not an oversight.

`resolveAsOfInstant` also throws if the reference `date` it is given precedes the earliest session
in the calendar it was handed, instead of silently resolving forward to that earliest session:
`ingest()`'s `resolveSgsFromDate` requests from the first ingested calendar day (2024-01-01)
onward, not an earlier backfill date, so this only fires if a caller passes a date outside
calendar coverage. Its sentinel for "no macro point ever ingested" is 2023-12-31, one day
_before_ that first calendar day, not the day itself: `resolveSgsFromDate` always resumes the day
_after_ whatever it is given, so a same-day sentinel would skip requesting the first calendar
day's own point (e.g. IPCA dated exactly 2024-01-01) forever.

**`asOf` is the publication instant, not the reference date's open** (ADR-0013). The session close
each point refers to is not when the rate becomes knowable:

- **CDI (12)**: known only once the session it describes has closed and Bacen computes it, so
  `asOf` is the **next** trading session's open after the reference date.
- **Selic target (432)**: takes effect from the reference date itself, so `asOf` is that date's own
  session open — unchanged from before. Bacen repeats the same rate for every calendar day,
  including weekends and holidays; `parseSgsResponse` drops any selic point whose date is not a
  session in the calendar it was given, since a non-session duplicate carries nothing a session-day
  point doesn't already give.
- **IPCA (13522)**: Bacen publishes the 12-month accumulated figure roughly mid-month for the
  previous month, so `asOf` is the open of the first session **on or after the 15th** of the month
  following the reference month.

The earlier version used the reference date's open for every series, which let a backtest see
CDI before it existed and IPCA up to ~40 days before its real publication — a look-ahead leak.
`resolveAsOfInstant` (`parser.ts`) takes the trading-session list it needs from the caller
(`sessionsFrom`, `repositories/calendar-repository.ts`, seeded by the calendar step that always
runs first in `ingest()`) rather than reaching into the database itself, keeping the adapter a
pure fetch-and-parse function.

## ANBIMA calendar (`adapters/anbima-calendar/`)

ANBIMA does not expose an API; it publishes one `.xls` (`feriados_nacionais.xls`, 2001-2099,
Windows-1252) at `https://www.anbima.com.br/feriados/arqs/feriados_nacionais.xls` — verified
2026-09-09, downloaded that day. It was parsed **once** with a scratch python/xlrd script (not a
repo dependency) into `adapters/anbima-calendar/anbima-national-holidays.json`
(`{date, name}[]`), which is committed and read at ingestion time; there is nothing to fetch over
the network for this source any more. `holidaysForYear` filters that list to a year and adds B3's
own Dec 24 / Dec 31 closures, which the ANBIMA file (bank holidays only) does not list; it throws
(`CalendarValidationError`) if a year has fewer than 8 ANBIMA holidays, which would otherwise mean
a truncated or malformed source file produces a calendar with silently missing sessions. Every
other weekday is a full trading session: open `13:00Z` (10:00 America/Sao_Paulo), close `20:00Z`
(17:00 America/Sao_Paulo). **Simplifying assumption, unchanged**: half-day sessions (Ash Wednesday
afternoon) are not modeled. `ingest()` ingests years `[2024, next_year]` on every run (previously
only the current year), so a session close to a year boundary is never missing its own year's
calendar.

## Monthly partitioning

`candles` and `option_daily_prices` are `PARTITION BY RANGE (session)` parents
(`drizzle/0002_market_data_reference_tables.sql`); `create_monthly_partitions(parent, start, end)`
is a Postgres function, idempotent (`CREATE TABLE IF NOT EXISTS ... PARTITION OF`), that creates
one partition per calendar month in `[start, end)`. The migration seeds partitions for 2024-01
through 2026-12; `ensureMonthlyPartition` (`repositories/partitions.ts`) calls the same function
for the ingested session's month before every write, so a new month is created on first use and
never needs its own migration (tested: `partitions.integration.test.ts`). Two concurrent callers
can still race past `IF NOT EXISTS` between Postgres sessions; `ensureMonthlyPartition` swallows
the loser's `42P07` (duplicate_table) instead of failing the run. `drizzle-kit` has no notion of
native partitioning, so `candles`/`option_daily_prices` are declared as ordinary tables in
`src/db/schema/market-data.ts` for the query builder's types; the migration SQL turns them into
partitioned parents by hand, edited after `drizzle-kit generate`. `data_version` (unused, no
reader ever consumed it) was removed from the schema and migration.

## Concurrency

Two overlapping invocations of the same source (two cron entries firing close together, or a cron
overlapping a manual retrigger) are serialized with `pg_advisory_xact_lock(hashtext(source))`
around the whole fetch-plus-write for that source (`repositories/advisory-lock.ts`); the lock is
transaction-scoped, so a crashed run releases it automatically. A `running` row whose `startedAt`
is older than the route's `maxDuration` is treated as failed and reaped
(`reapStaleRunningRuns`) before a new attempt starts, so a run that crashed mid-flight (no
`finishRun` ever called) does not permanently block every later retry for that `(source,
session)`. Combined with the unique partial index above, at most one `succeeded` row per
`(source, session)` is a hard database invariant, not just serialized application logic.

## Inserts

Rows within a single file (or fetch window, for SGS) are chunked at 1000 per `INSERT` and
deduplicated by natural key before the insert (last row wins) — COTAHIST, the registry and SGS
occasionally repeat a key within one file or window; without dedup that becomes a Postgres "ON
CONFLICT DO UPDATE command cannot affect row a second time" error, not a silent bug, but chunking
and dedup keep both large-file performance and correctness in one place
(`repositories/candle-repository.ts`, `.../option-repository.ts`, `.../macro-repository.ts`).

## Retry schedule (ADR-0010)

22:00 America/Sao_Paulo plus 00:30 and 06:00 → 01:00, 03:30, 09:00 UTC (`apps/web/vercel.json`,
three cron entries, no DST in Brazil since 2019). Every entry hits the same bearer-protected
`GET /api/cron/ingest`; a run that finds every session in its window already `succeeded` per
source is a no-op ("Session selection" above).

## Manual trigger

The same route accepts `POST` with the bearer and an optional JSON body `{ "session": "YYYY-MM-DD" }`
(Zod-validated, `sessionDateSchema` from `@fetha/contracts`, unknown fields rejected) to re-run a
specific session (for Playwright and for the owner). A malformed body returns `400` before
touching the database; the bearer check is identical to `GET` and is the only rate limit (the
secret is never logged or echoed). This is the owner's only access path today and is acceptable
under `REGISTRATION_MODE=invite`; the CRON_SECRET must be rotated after any human use of the
manual trigger, and a proper owner-session gate (replacing the shared bearer for human use) is
tracked in #51.

## Response shape

`ingest()` returns `{ session, ok, sources }`: `ok` is `false` if any source outcome carries an
`error`, and the route (`api/cron/ingest/route.ts`) mirrors that into the HTTP status (`200` when
`ok`, `500` otherwise) so a monitoring probe or the Playwright e2e can assert per-source status
from one response instead of querying `ingestion_runs` directly.

## Freshness

`market-data` exposes `latestSession(db, at)` (the most recent trading session with `close <= at`),
`freshness(db)` (the latest recorded `ingestion_runs` row per source, whatever its status) and
`gaps(db, source, at)` / `allGaps(db, at)` (the un-succeeded sessions in the last-10 window,
"Session selection" above) — the functions #13's market bar reads (`freshness.ts`).

## What adjustment covers, and what it does not (ADR-0004)

COTAHIST prices are **not adjusted for corporate actions** and the file **includes delisted
instruments** (survivorship-neutral, not survivorship-bias-free by omission). `FATCOT` is a
quotation-lot factor (grouping, e.g. `1000` for some BDRs/FIIs), not a corporate-action
adjustment; the `corporate_action_factors` table exists (ADR-0013's engine reads it) but nothing
in this ticket writes to it any more. The earlier `detectFatcotFactorChanges` /
`upsertCorporateActionFactors` pair, which inferred a factor from a `FATCOT` change between two
sessions, is **removed**: per quant review it used the absolute `FATCOT` value as if it were an
adjustment ratio, applied it to prices already normalized by that same `FATCOT`, and was keyed on
the option ticker rather than the underlying — wrong on all three counts, and it was never wired
into `ingest()` regardless. Recording real corporate-action factors (from a labeled event, not an
inferred `FATCOT` change) is tracked in #50 and is out of this ticket's scope; see also
`UBIQUITOUS_LANGUAGE.md` ("Reference data") and `docs/adr/0004-backtest-hygiene.md`, both updated
to point at #50. **Dividends remain uncovered**: no source this ticket adds carries dividend data.

## Port (amends ADR-0007)

ADR-0007 originally implied `MarketDataProvider` covered every data source; it does not. ADR-0007
is amended with one paragraph: `MarketDataProvider` is the **per-user intraday** seam only
(brapi.dev today, OpLab a candidate second adapter) — live quotes, chain, intraday candles, all
behind a user-supplied token. The four reference-data sources this ADR describes are **not**
behind that interface; each is a fetch-and-parse function private to `market-data`
(`adapters/<source>/fetch.ts` + `parser.ts`), called directly by `ingest()`. There was never a
second implementation to justify an interface here, and none of these sources takes a per-user
token.

## Considered options

- **A dedicated dividend feed in this ticket**: out of scope; no free, redistributable dividend
  source was confirmed during research (docs/research/2026-09-02-market-data-providers.md); adding
  one is a separate ticket once a source is confirmed.
- **Half-day sessions modeled from day one**: deferred; the exceptions are few and dated, and
  getting the boundary instants right (are half-day intraday candles still ingested?) is more
  ADR than this ticket's scope, hence the documented simplification above.
- **Re-deriving corporate-action factors from FATCOT with a corrected formula, in this ticket**:
  rejected; getting the ratio right needs the previous session's per-ticker FATCOT persisted or
  re-read, and a labeled-event source is a stronger basis than inferring from a lot-factor change
  either way — tracked as #50 instead of a second attempt at the same wrong shortcut.
- **A generic `MarketDataProvider` implementation per reference-data source**: rejected (see
  "Port" above); no second implementation, no per-user token, and it would blur the one interface
  this codebase actually needs to keep stable (ADR-0006).
