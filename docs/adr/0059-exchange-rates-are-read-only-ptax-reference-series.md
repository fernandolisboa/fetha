---
status: accepted
date: 2026-10-13
---

# Exchange rates are a read-only PTAX reference series (#305)

## Context

The owner wants to track USD/BRL and EUR/BRL in the same shared, read-only reference data as CDI,
Selic and IPCA (ADR-0017), findable from the command search and shown in the market bar, without
dragging in anything a currency is not: no watchlist entry, no strategy, no backtest, no signal, no
dollar options. Bacen's SGS already carries the Central Bank's own daily fixing for both pairs —
the PTAX "venda" (selling) rate — under the same provider this app already ingests CDI, Selic and
IPCA from (ADR-0017, ADR-0007), verified live against `api.bcb.gov.br` on 2026-10-13: series `1`
(USD selling) and `21619` (EUR selling).

PTAX is not a trading-session close. Bacen publishes it on its own business-day calendar, which
differs from B3's: a date B3 treats as a holiday can still carry a published PTAX point, and
nothing requires the reverse either. Folding it into `macro_points` (CDI/Selic/IPCA) would force it
through `resolveAsOfInstant`'s session lookups, which assume the reference date (or a `sessions`-
derived instant) that genuinely needs a trading-session calendar to resolve `asOf` — PTAX does not;
its publication instant is fixed by Bacen's own practice, not by when a B3 session opens or closes.

## Decision

**A new table, `exchange_rates`** (`modules/market-data/schema.ts`), shared read-only reference
data like every other table in that file (CLAUDE.md principle 5): no `user_id`, written only by
ingestion, read by every user. Columns: `pair` (`'USDBRL' | 'EURBRL'`, an `exchangeRatePairSchema`
Zod enum next to `macroSeriesKindSchema`'s own in `adapters/bacen-sgs/schema.ts`), `date`,
`as_of` (`timestamptz`) and `rate` (`numeric(18,8)`), primary keyed on `(pair, date)`. Migration
`0036`. No isolation test: the exception CLAUDE.md principle 5 and ADR-0017 already carve out for
reference data and the catalog.

**A new ingestion source, `ptax`**, added to `ingestionSourceValues` — **not** folded into the
`sgs` loop. The two have different failure budgets: `sgs`'s newest-session CDI point is what
tonight's `iv_index` computation needs (ADR-0054's addendum), so a slow or down PTAX endpoint must
never cost `sgs`, `cotahist`, `instruments` or `iv_index` any of their own start budget. `ptax` runs
last in `ingest()`, after `iv_index`, oldest gap session first, each session fetching cumulatively
from `(latest stored date for the pair) + 1 day` to the session — the same shape `sgsRun` already
uses.

**It is split the same way `sgs` is (#298, not folded into one deadline).** The newest gap session
is the only one allowed to report `{ pending: true }` on a not-yet-published value, so an older gap
stalling Bacen must never starve it of its own attempt this run. Older gap sessions stop starting at
`startedAt + maxDurationMs * 0.7`; the newest one gets its own, later deadline,
`startedAt + maxDurationMs * 0.8`. A stalled Bacen costs about 31s per series per session (the same
timeout/retry budget `fetchWithOneRetry` already spends on SGS), two series about 62s worst case; a
session starting right at 80% of a 300s `maxDurationMs` (240s) and running that full 62s ends around
302s, essentially at the route's own 300s deadline rather than comfortably inside it — the same
shape `sgs`'s 93s-worst-case-at-60%-start already accepts for the exact same reason (ADR-0017's
`sgs` addendum): that run still ends in time to record itself, and the next run retries whatever it
missed. 80%, not later, is what still leaves any margin at all for `ptax` to run after `iv_index`.
`ptaxBudgetMs` on `IngestOptions` overrides the older sessions' deadline for tests, mirroring
`sgsBudgetMs`; the newest session's own 80% deadline has no override, the same as `sgs`'s newest
session relying on `iv_index`'s fixed 60% hard stop with none.

Not-published handling mirrors `sgs` exactly (#216/#289): `SgsNotPublishedError` on the newest gap
session reports `{ pending: true }`, no succeeded marker written, retried the next run; the same
error on an older gap session is a real failure (Bacen publishes same-day, so a value still missing
a session later means something is actually wrong) and fails that session's own run. Backfill
starts from the same `SGS_DEFAULT_SINCE` (2024-01-01) `sgsRun` already uses, so exchange-rate
history begins the same day every other reference series does — and because each session's own
fetch is cumulative from the pair's latest stored date, the very first gap session ever attempted
already brings in all of that history in one request; `ptax` never carries a night-after-night
backfill queue the way `iv_index` does. A `ptax` error flips `ingest()`'s own `ok` the same way an
`sgs`/`instruments` error does (unlike `iv_index`, which is excluded); `run-nightly-job.ts`'s
`cotahistSucceeded` gate already keys evaluation on `cotahist` alone, not on `ok`, so a `ptax` error
— like an `sgs` one — still never blocks evaluation. The owner's manual trigger
(`hasUnsurfacedTrouble`, `nightly/actions.ts`) treats a `ptax` deferral as trouble, the same way an
`sgs` one already is (#298): unlike `iv_index`'s own exemption, there is no routine backfill drain
to excuse it — a deferred `ptax` session means its own start budget was starved, full stop.

**The HTTP leg is shared, by SGS code, with the macro adapter.** `adapters/bacen-sgs/fetch.ts` is
refactored minimally: the one-retry, 15s-timeout, not-yet-published-classified request that used to
be `fetchSgsSeries`'s own inline loop is now `fetchSgsWindows(code, label, from, to, fetchImpl,
retryDelayMs)`, returning the raw validated JSON bodies for the 10-year windows in range. Both
`fetchSgsSeries` (macro) and the new `fetchPtaxSeries` (PTAX) call it with their own SGS code and
parse the bodies themselves — `parseSgsResponse` (unchanged behavior) for macro series,
`parsePtaxResponse` (new, `adapters/bacen-sgs/ptax-parser.ts`) for PTAX. `SgsNotPublishedError` and
the surrounding error messages now carry a `label: string` instead of a `MacroSeriesKind`, so the
same typed errors and the same message hygiene (#289: never quote provider text) serve both.

**The PTAX parser never filters by a trading-session calendar.** Unlike `parseSgsResponse`'s selic
branch (which drops a non-session duplicate) or its cdi/ipca branches (which resolve `asOf` against
`sessions`), `parsePtaxResponse` takes no `sessions` argument at all: every published date is kept,
because Bacen's own business-day calendar for PTAX differs from B3's and nothing in this ticket's
scope needs it reconciled against the trading calendar. `asOf` is fixed at `13:30 America/Sao_Paulo`
(`16:30Z`; Brazil has not observed DST since 2019, so this is a constant offset) on the reference
date — a documented publication instant (Bacen publishes PTAX around 1pm), independent of any
session open/close this module otherwise carries. Rates are decimal strings via `decimal.js`
(`toFixed(8)`), never a JS `number` (CLAUDE.md).

**Search stays out of the watchlist.** `matchExchangeRates` (`modules/market-data/exchange-rate-
match.ts`) is a pure, client-safe function over the two static pairs: a prefix match on the pair
code itself (`"usd"` → `USDBRL`) and on an accent-insensitive Portuguese alias (`"dólar"`/`"dolar"`
→ `USDBRL`, `"euro"` → `EURBRL`). No server action, no database query — the universe is two
constants, and the matcher returns the pair alone, never a label: the one label shown for a pair
(the search result, the page's own chip) is read from `marketDataStrings.exchangeRate.pairLabel`,
re-exported through the client-safe `market-data/client.ts` barrel, so the command search and the
page never carry two copies of the same Portuguese string. `CommandSearch` renders its own
`"Câmbio"` group unconditionally whenever it has a hit — independent of the three async groups'
own pending/rate-limited/failed state, since matching is local and instant — each item linking to
`/cambio/<PAIR>`; the search's live-region status text still announces "Buscando…" while the async
sources are in flight even if the exchange-rate group already has a hit, since that announcement is
keyed on the async state alone, not on whether anything is visible yet.

**The page**, `app/(shell)/cambio/[pair]/page.tsx`: an unknown pair 404s. It reads every point for
the pair from `exchange-rate-repository.ts` and renders a `PageHeader` (overline "Câmbio"), chips
naming the pair, "PTAX de venda" and "Banco Central (Bacen)", the last rate in Brazilian format
(`R$ 4,9892`) with its date, a short note that PTAX is a reference rate published around 1pm on
business days — explicitly not a market close — and a daily line chart (`RateLineChart`, a new
small component beside `CandleChart`, taking a plain `{ date, rate }[]` domain shape rather than the
repository's own row type, using `lightweight-charts`' `LineSeries` and the `--chart-stroke` token).
`formatExchangeRateBRL` (`lib/format/brl.ts`) renders a rate at four decimals with the `R$` prefix
(rounded half up, like `formatPriceBRL`), distinct from `formatPriceBRL`'s money-rounding-to-
centavos. The page does not publish the pair through `InstrumentMarketBar`/`MarketBarProvider`:
that context's `session` field means a B3 trading session and the bar phrases it as "fechamento de
hoje"/"fechamento de ontem", which a PTAX date is not — the shell's own USD/BRL chip (below) already
covers USD/BRL in the bar, and the page body already shows the last PTAX with its own date.

**The market bar always shows the latest USD/BRL PTAX** (`USD/BRL R$ 4,9892`, the same
`formatExchangeRateBRL` the page uses, so the figure reads identically everywhere), linking to
`/cambio/USDBRL`; its date is shown as visible muted text from the `lg` breakpoint up — the same
breakpoint the focused instrument's own freshness phrase uses — and otherwise as the link's `title`,
hidden entirely below `sm` so the chip never grows the bar past the width `e2e/shell.spec.ts`
already tests for overflow. This is loaded server-side in the shell layout (one
`latestExchangeRate(db, "USDBRL")` read) and passed down as a prop through `AppShell` → `Header` →
`MarketBar`, not through `MarketBarProvider`: that context is for whatever page is currently
focused (an instrument, an option series) to publish its own last price, while the USD/BRL figure
is a shell-wide fixture visible on every screen, the same distinction the bar's own existing comment
already draws for IBOV/CDI (out of this ticket's scope). That read is wrapped in its own try/catch,
collapsing any failure (a migration not yet applied to an environment, a transient database error)
to `null` — a hidden chip, not a 500 on every signed-in page; nothing from the error is logged.

## Consequences

- `exchange_rates` joins `macro_points`, `trading_sessions`, `ingestion_runs` and the implied-
  volatility index as shared reference data with no isolation test.
- A currency is explicitly not optionable, not a strategy input and not backtestable from this
  ticket: no FX structure, no FX signal, no dollar-denominated payoff. A later ticket that wants any
  of that reopens this decision rather than assuming it.
- The nightly report, the owner's manual ingestion panel and every other place that enumerates
  `IngestionSource` (`freshness.ts`'s `SESSION_BOUND_SOURCES`, derived from `ingestionSourceValues`,
  needed no change) now also carries `ptax`.
- Known limitation: `exchange_rates` has no corporate-action-style correction path; a wrong PTAX
  point is corrected the same way a macro point is — re-ingest and let the upsert overwrite it.
