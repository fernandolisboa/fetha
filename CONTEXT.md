# Fetha — Context

Fetha is a personal trading and investment lab for the Brazilian market (B3). A user studies,
prices and backtests options structures and directional strategies on their own declared
capital, records the decisions they take and sees how those decisions age. It is a free
decision-support tool: no fees, no plans, no order execution, no broker connection. Every number
on screen comes from the engine; the AI only reasons over engine output. The vocabulary is in
`UBIQUITOUS_LANGUAGE.md`; decisions are in `docs/adr/`.

## Users

Multi-user by design, single user in practice. Each user analyzes their own capital with their
own inputs and sees only their own operations, positions, decisions and analyses. Family and
friends may register later (`REGISTRATION_MODE`). The only things users share are reference
data, the catalog and strategies a user chose to share. The owner (`OWNER_EMAILS`) is an operator
capability over one system job, not a tenancy role — it changes nothing about the isolation above
(ADR-0042).

## Modules

| module        | owns                                                                                                                                                                                                                                        | exposes                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `auth`        | accounts, sessions, registration mode, email-first registration, terms acceptance and re-acceptance on a version change, sign-in (password or magic link), password reset, rate limiting, purge of unverified accounts and expired sessions | the current user                                                                       |
| `audit`       | the access log: each read or export of a user's portfolio and decision data                                                                                                                                                                 | the current user's access log; `recordAccess` for read models                          |
| `account`     | nothing of its own: the user's data export, assembled from every module's own export                                                                                                                                                        | the export document                                                                    |
| `preferences` | per-user workstation settings (theme, rail collapse state, guided-tour dismissal)                                                                                                                                                           | the current user's preferences                                                         |
| `market-data` | reference data (daily candles, option series, daily option prices, corporate-action factors, macro series, trading calendar) and the per-user intraday tier (live quotes, chain, intraday candles fetched with the user's token)            | data views by instrument, timeframe and date range; the `MarketDataProvider` interface |
| `engine`      | every computation: indicators, fair value, implied volatility, greeks, payoff, backtest runs, risk metrics, scoring                                                                                                                         | a pure public interface, frozen by ADR-0013 (ADR-0006 sets the boundary)               |
| `strategies`  | the catalog of structures and reference strategies; each user's strategies and versions; sharing; signal evaluation and the signal inbox                                                                                                    | the structure catalog, strategy versions, signals                                      |
| `watchlist`   | each user's list of followed instruments                                                                                                                                                                                                    | the current user's watchlist                                                           |
| `portfolio`   | fills (manual or imported from the B3 export), positions, operations and their lifecycle, contemplated operations, mark to market, risk profile and limit checks                                                                            | the portfolio view, operation lifecycle commands, the operation builder                |
| `backtests`   | backtest runs, their checkpoints and reports                                                                                                                                                                                                | run creation, chunked resume, the report, the comparison of runs                       |
| `decisions`   | decisions, theses, AI analyses, the journal and scores                                                                                                                                                                                      | the journal, analysis requests                                                         |
| `nightly`     | the purge → ingest → evaluate → score sequence the nightly job runs (ADR-0042); the redacted per-run report (`nightly_runs`, ADR-0045)                                                                                                      | `runNightlyJobRecorded`, the owner's manual trigger action                             |

Modules are deep: small entry points, private implementation. Cross-module reads go through the
exposing module's interface, never through its tables.

## Key flows

1. **Nightly ingestion, daily evaluation and scoring.** A nightly job with scheduled retries
   (ADR-0010, ADR-0017) ingests COTAHIST, the B3 instruments registry, Bacen SGS and the trading
   calendar (corporate-action factor recording is a follow-up, #50; the engine derives adjusted
   series point in time from whatever factors exist, ADR-0013), then evaluates every active daily
   strategy over each user's watchlist and deposits signals in their inbox (a catch-up logs up to
   21 sessions but sends only the last five sessions' entries to the inbox, ADR-0044; a user
   can re-evaluate one strategy on one session after a data correction, append-only and audited,
   ADR-0047). Sizing an entry
   uses the user's own declared risk profile (#22); a user with none declared still gets a
   full evaluation, just never a sized entry signal (the engine's `unsizeable` outcome, logged,
   never in the inbox). The same run then scores every decision whose horizon has arrived
   (#29): `decisions/scoring-service.ts` scores every user's due decisions with the engine's
   `score()`, one append-only row per decision (`decision_scores`), never blocking or failing the
   ingestion response on a scoring error. Analyses aren't scored yet — that table doesn't exist
   until #28. `nightly/run-nightly-job.ts` owns this sequence; Vercel Cron's own `GET` on
   `api/cron/ingest` (bearer `CRON_SECRET`) is the only automated trigger. The owner's manual
   re-run of a session is a session-authenticated Server Action gated on `isOwner()`
   (`OWNER_EMAILS`, ADR-0042), never `CRON_SECRET` — that secret never reaches a human. Every run,
   cron or manual, writes one redacted row to `nightly_runs` (ADR-0045), so an agent can read what
   last night's run did without a Vercel log screenshot.
2. **Intraday while in use.** With the app open and a provider token set, the client refreshes
   live quotes, chain and intraday candles per closed candle; intraday strategies are evaluated
   on each candle and caught up on reopening (late signals marked). Intraday candles fetched
   with a user's token are persisted in that user's space. Nothing polls when the app is closed.
3. **Build and price a structure.** The user picks a structure from the catalog, instantiates
   legs on an underlying (series, strikes, expiry, quantities), and the engine returns payoff,
   fair value per leg, implied volatility, greeks, break-evens, max loss and max gain, checked
   against the risk profile (warn on screen, refuse in backtests unless configured to warn).
   Saving the priced structure records a Contemplated Operation, a snapshot the user can revisit
   before deciding; it is not an Operation and opens no position.
4. **Backtest.** A strategy version, a universe, a period, an initial capital, a cost model and a
   sizing rule produce an immutable, reproducible run: simulated operations and fills, equity
   curve, metrics, walk-forward view. Fills happen in the next session of a daily run (ADR-0004)
   or the next candle of the strategy timeframe in an intraday run (ADR-0011, as sharpened by
   ADR-0013 and ADR-0014); missed fills, warn mode and walk-forward follow ADR-0014.
5. **Decide and journal.** From a signal, an operation or a structure, the user requests an
   analysis (on demand, capped) and records a decision (enter, do not enter, hold, adjust, exit)
   with a thesis and horizon; an open operation of the real portfolio takes hold, adjust or exit
   decisions, scored on the position held and its own fills once any expired option is settled
   (ADR-0022). At the horizon the engine scores the decision (#29); the analysis is scored the
   same way once #28 lands (ADR-0005). The journal shows the user's track record today; the AI
   calibration slot stays an empty state until #28 gives it analyses to score.
6. **Track the real portfolio.** Fills are entered by hand or imported from the B3 investor-area
   spreadsheet; they form positions; the user groups fills into operations; the engine marks
   everything to market and proposes exercise or expiry outcomes on expiry dates, which the user
   confirms or corrects. Only fills and operations are stored; positions and cash are derived
   from fills, and cash starts from the declared capital (ADR-0021).

## Invariants

- The AI never produces numbers; every figure shown comes from the engine and every analysis
  cites its inputs.
- Strategies are data: JSON with a closed vocabulary, versioned, immutable once referenced.
- Backtest hygiene is enforced by the engine: no look-ahead, fills in the next candle or session,
  costs always charged, deterministic runs.
- A signal and a backtest of the same strategy version resolve warm-up identically: both
  `strategies/evaluate-version.ts` (shared by the nightly `evaluate-signals.ts` and the user's
  re-evaluation, `reevaluate-session.ts`) and `backtests/run-chunk.ts` build their own `DataWindow` from
  the engine's own `dataWindow()` and hand it unchanged to `market-data`'s `loadMarketView`, never
  re-deriving the boundary themselves. (A third caller, `backtests/actions.ts`, also builds a
  `DataWindow` at creation time to decide the `impliedVolatilityIndex` refusal; harmless to this
  invariant today since it only reads `collections`, which does not depend on `at`/`since`, but a
  reader trusting "two callers" alone would be wrong.) Not guaranteed by a single shared entry
  point (that seam was considered and rejected, #18/#19); guaranteed by construction of
  `dataWindow()` plus `apps/web/src/modules/backtests/data-window-parity.integration.test.ts`,
  which pins the two session-resolving callers against each other.
- A recursive indicator is read at each evaluated candle over a fixed trailing window of calendar
  sessions ending there (`3 * length` for `ema`, `6 * length` for `rsi` and `atr`), never over
  whatever older history a view happens to hold, so a one-night run, a catch-up, a re-evaluation and
  a backtest bar agree on a session's reading, missing sessions included (ADR-0048).
- An indicator's `length` is at most 500 and an `iv_rank` lookback at most 1,260 sessions, enforced
  where a strategy definition is written (`strategyDefinitionInputSchema`), never where a stored
  one is read: a version saved before a bound stays readable, backtestable and evaluable
  (ADR-0049).
- An `sma` is read only when its last `length` candles all fall inside the window of `length`
  sessions ending there; a session without a candle leaves it unread while it stays in the window,
  in every run shape with the same window end, for entry and exit conditions alike (ADR-0050).
- Tenant isolation: every user-scoped table carries `user_id`; repositories take the user from
  the session. Exceptions, read-only to users: reference data, the catalog and shared strategies.
- Prices are decimals, money is integer centavos, quantities are integers; never a float for
  money.
- No broker integration and no order execution (ADR-0003).
- Licensed or public data only; intraday data is fetched with each user's own provider token and
  cached for that user alone.

## Decisions

See `docs/adr/`: numeric representation (0001), option pricing (0002), no broker integration
(0003), backtest hygiene (0004), decision scoring (0005), engine boundary (0006), data providers
(0007), strategy DSL (0008), AI decision contract (0009), intraday evaluation while in use
(0010), intraday backtests (0011), strategy sharing (0012), the engine public interface (0013),
evaluation, backtest and scoring rules settled with it (0014), themes as per-user token sets
(0015), auth and tenancy: Better Auth, the user account as the tenant (0016), reference data
ingestion: sources, partitioning, retries, freshness, adjustment (0017), magic link, password
reset and database-backed rate limiting (0018), vertical slices inside the single Next.js app
(0019), registration mode through Vercel Global Config (0020), real portfolio bookkeeping: fills
are stored, positions and cash derived (0021), decisions on held operations scored with the
portfolio's own fills (0022), strategy comparison and walk-forward over persisted runs (0023),
account rate-limit keys hashed and purged (0024), a PWA that caches build output only (0025),
HTTP security headers on every response (0026), LGPD: access log, data export and account
deletion (0027), email-first registration and the purge of unverified accounts (0028), invites spent by mailbox
proof (0029), verification tokens stored hashed (0030), mail sent after the response and a
failures-only sign-in account bucket (0031), per-user caps on backtest runs in progress and
strategy versions (0032), expired sessions purged nightly (0033), the change-password and
verify-password endpoints closed (0034), a nonce script-src enforced on every routed page (0035),
a signed-in gate that asks existing users to re-accept a new terms version (0036), discarding a
stuck backtest run and listing runs in progress across strategies (0037), `fixed_fractional`
sizing a net-debit structure on its bounded max loss (0038), a typed web-authored evaluation
vocabulary with `EvaluationRecord.detail` removed from the engine (0039), B3 fees by instrument
class (0040), metrics over observed sessions (0041), owner-gated manual ingestion (0042),
strategies archived, never deleted, and out of the cap (0043), entry proposals older than five
sessions kept out of the inbox (0044), a redacted nightly run report recorded by every run (0045),
the guided tour's dismissal kept as a per-user preference (0046), and append-only, audited re-evaluation of one session (0047).
