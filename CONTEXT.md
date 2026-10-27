# Fetha — Context

Fetha is a personal trading and investment lab for the Brazilian market (B3). A user studies,
prices and backtests options structures and directional strategies on their own declared
capital, records the decisions they take and sees how those decisions age. It is a free
decision-support tool: no fees, no plans, no order execution, no broker connection. Fetha
suggests operations in its own voice, from its recipes' rules, its models and past data, and its
suggestions are scored like the user's decisions (ADR-0067); every decision, and every order at
the broker, is the user's own. Every number on screen comes from the engine; the AI only reasons
over engine output. The vocabulary is in `UBIQUITOUS_LANGUAGE.md`; decisions are in `docs/adr/`.

## Users

Multi-user by design, single user in practice. Each user analyzes their own capital with their
own inputs and sees only their own operations, positions, decisions and analyses. Family and
friends may register later (`REGISTRATION_MODE`). The only things users share are reference
data, the catalog and strategies a user chose to share. The owner (`OWNER_EMAILS`) is an operator
capability over one system job, not a tenancy role — it changes nothing about the isolation above
(ADR-0042).

## Modules

| module        | owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | exposes                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`        | accounts, sessions, registration mode, email-first registration, terms acceptance and re-acceptance on a version change, sign-in (password or magic link), password reset, rate limiting, purge of unverified accounts and expired sessions                                                                                                                                                                                                                                                                                                                                                                        | the current user                                                                                                                                                                                                  |
| `audit`       | the access log: each read or export of a user's portfolio and decision data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | the current user's access log; `recordAccess` for read models                                                                                                                                                     |
| `account`     | nothing of its own: the user's data export, assembled from every module's own export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | the export document                                                                                                                                                                                               |
| `preferences` | per-user workstation settings (theme, layout, rail collapse state, guided-tour dismissal)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | the current user's preferences                                                                                                                                                                                    |
| `market-data` | reference data (daily candles, option series, daily option prices, corporate-action factors, macro series, exchange rates/PTAX (ADR-0061), the Ibovespa's daily close under `IBOV11` read nightly from B3's own index service (`indexes`, ADR-0062), trading calendar, the implied-volatility index computed nightly from the others, ADR-0054; company filings delivered to the CVM and the ticker-to-CNPJ map, ADR-0060) and the per-user intraday tier (live quotes, chain, intraday candles fetched with the user's token)                                                                                     | data views by instrument, timeframe and date range; the `MarketDataProvider` interface; `isMarketIndex`                                                                                                           |
| `engine`      | every computation: indicators, fair value, implied volatility, greeks, payoff, backtest runs, risk metrics, scoring, the asset reading (trend/momentum/range/IV/option-liquidity labels, ADR-0059)                                                                                                                                                                                                                                                                                                                                                                                                                 | a pure public interface, frozen by ADR-0013 (ADR-0006 sets the boundary)                                                                                                                                          |
| `strategies`  | the catalog of structures and reference strategies; the recipe book (ADR-0064); each user's strategies and versions; sharing; signal evaluation and the signal inbox                                                                                                                                                                                                                                                                                                                                                                                                                                               | the structure catalog, strategy versions, signals                                                                                                                                                                 |
| `watchlist`   | each user's list of followed instruments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | the current user's watchlist; the distinct tickers anyone follows, the first part of the sentiment job's universe (ADR-0065)                                                                                      |
| `portfolio`   | fills (manual or imported from the B3 export), positions, operations and their lifecycle, contemplated operations, mark to market, risk profile and limit checks                                                                                                                                                                                                                                                                                                                                                                                                                                                   | the portfolio view, operation lifecycle commands, the operation builder                                                                                                                                           |
| `backtests`   | backtest runs, their checkpoints and reports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | run creation, chunked resume, the report, the comparison of runs                                                                                                                                                  |
| `recipes`     | nothing of its own: the one-click flow that copies a recipe (ADR-0064) into the user's strategies, adds the instrument to the watchlist and starts its backtest                                                                                                                                                                                                                                                                                                                                                                                                                                                    | the recipe picker on the asset page, `startRecipeAction`                                                                                                                                                          |
| `radar`       | the nightly read of liquid optionable underlyings against the recipes: shared readings and matches (`radar_readings`, `radar_matches`, ADR-0066), shown as the watchlist page's Radar tab; the suggestions those matches become when priced for one lot, and their scores (`suggestions`, `suggestion_scores`, ADR-0067); each user's sightings of them (`suggestion_sightings`, user-scoped, ADR-0074), and the on-demand re-check of the last 5 sessions' findings at the newest close against the user's own risk profile (the suggestion research, ADR-0075; what the AI makes of it is stored by `decisions`) | the radar tab, today's suggestion cards, the suggestion page, the suggestion calibration panel, the engine part of the "Obter sugestões" button (`researchSuggestionsAction`), `scanRadar`, `scoreDueSuggestions` |
| `decisions`   | decisions (on a signal, a contemplated or held operation, a suggestion or a research idea), theses, AI analyses, Fetha's researches with their ideas and scores (`suggestion_researches`, `research_ideas`, `research_idea_scores`, ADR-0076), the journal and scores                                                                                                                                                                                                                                                                                                                                              | the journal, analysis requests, the "Obter sugestões" button's panel (`obtainSuggestionsAction`), "Pesquisas do Fetha"                                                                                            |
| `nightly`     | the purge → ingest → evaluate → score (decisions, analyses, suggestions, researches) → radar → sentiment sequence the nightly job runs (ADR-0042); the redacted per-run report (`nightly_runs`, ADR-0045)                                                                                                                                                                                                                                                                                                                                                                                                          | `runNightlyJobRecorded`, the owner's manual trigger action                                                                                                                                                        |
| `sentiment`   | sentiment reference data: AI labels on company filings (topic, tone, a one-sentence summary with no figure), daily GDELT news tone per company, a paid provider's scored articles (ADR-0065)                                                                                                                                                                                                                                                                                                                                                                                                                       | the asset page's "Sentimento" view; the `NewsSentimentProvider` interface                                                                                                                                         |

Modules are deep: small entry points, private implementation. Cross-module reads go through the
exposing module's interface, never through its tables.

## Key flows

1. **Nightly ingestion, daily evaluation and scoring.** A nightly job with scheduled retries
   (ADR-0010, ADR-0017) ingests COTAHIST, the B3 instruments registry, the Ibovespa's daily close
   (`indexes`, under `IBOV11`, ADR-0062; runs after `instruments` and before `sgs`, so the level
   lands before `iv_index` decides which underlyings to compute), Bacen SGS and the trading
   calendar, then computes the implied-volatility index for that session from those same sources
   (`iv_index`, no new provider, ADR-0054; eligible only once cotahist and instruments have both
   succeeded for the session and `indexes` either succeeded or was never attempted for it this
   run, with a time-budgeted backfill for sessions that predate it), and reads the CVM's filings
   of listed companies (`cvm_filings`, ADR-0060)
   (corporate-action factors are entered by the owner on `/configuracoes`, not this job, #50,
   ADR-0052; the engine derives adjusted series point in time from whatever factors exist,
   ADR-0013). USD/BRL and EUR/BRL PTAX (`ptax`, ADR-0061) ingest last, after `iv_index` and `cvm_filings`, so a slow
   or down Bacen PTAX endpoint never costs any other source its own start budget; it has its own
   two start deadlines (an older gap session, then the newest gap session later still) mirroring
   `sgs`'s own split (#298). Then the job evaluates every active daily
   strategy over each user's watchlist and deposits signals in their inbox (a catch-up logs up to
   21 sessions but sends only the last five sessions' entries to the inbox, ADR-0044; a user
   can re-evaluate one strategy on one session after a data correction, append-only and audited,
   ADR-0047). Sizing an entry
   uses the user's own declared risk profile (#22); a user with none declared still gets a
   full evaluation, just never a sized entry signal (the engine's `unsizeable` outcome, logged,
   never in the inbox). The same run then scores every decision whose horizon has arrived
   (#29): `decisions/scoring-service.ts` scores every user's due decisions with the engine's
   `score()`, one append-only row per decision (`decision_scores`), never blocking or failing the
   ingestion response on a scoring error. AI analyses (#28, ADR-0057) are requested on demand, not
   by this job; right after the decisions, `decisions/analysis-scoring-service.ts` scores every
   accepted analysis whose outlook's horizon has arrived, on its claim alone, one append-only row
   per analysis (`analysis_scores`, ADR-0058). Then the radar (`radar/scan.ts`, ADR-0066) reads
   the newest session's liquid optionable underlyings against the recipes and stores their
   readings and matches as shared reference data, resumable per underlying under the same
   deadline; a match the engine fully prices for one standard lot is also stored as a suggestion
   (ADR-0067), and `radar/suggestion-scoring.ts` scores every suggestion whose horizon arrived
   on the same as-of session, one append-only row each (`suggestion_scores`); right after,
   `decisions/research-scoring-service.ts` (`scoreDueResearch`) scores the same way every
   research idea whose horizon arrived, per user, whatever its verdict (`research_idea_scores`,
   ADR-0076). Last, `sentiment` labels the recent filings of every watched company, and of the
   underlyings the radar found in its last five read sessions (at most 40 on top of the watchlist,
   ADR-0065), with Claude Haiku (behind a code switch, on in production since the owner confirmed the cost), reads their
   GDELT news tone and, when a key is set, a paid provider's scored articles (ADR-0065).
   `nightly/run-nightly-job.ts` owns this sequence; Vercel Cron's own `GET` on
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
4. **Start from a recipe.** On the asset page the user says what they expect the instrument to
   do and how much they accept to lose per operation; Fetha lists the matching recipes (ADR-0064),
   copies the chosen one into the user's strategies as a new inactive strategy, adds the
   instrument to the watchlist, backtests it over the last two years and opens the report. The
   user turns the strategy on from there.
5. **Backtest.** A strategy version, a universe, a period, an initial capital, a cost model and a
   sizing rule produce an immutable, reproducible run: simulated operations and fills, equity
   curve, metrics, walk-forward view. Fills happen in the next session of a daily run (ADR-0004)
   or the next candle of the strategy timeframe in an intraday run (ADR-0011, as sharpened by
   ADR-0013 and ADR-0014); missed fills, warn mode and walk-forward follow ADR-0014.
6. **Decide and journal.** From a signal, a contemplated operation, a held operation, a complete
   backtest run or a suggestion, the user may request one AI analysis (on demand, a monthly cap
   per user, ADR-0057), on a model family (Haiku, Sonnet or Opus) the user can pick per kind under
   Configurações, resolved to that family's newest release, and billed to their own Anthropic key,
   which they must store first (ADR-0068, amended #325): the engine's own computed facts go in as
   a checked `AnalysisInputs` tree, the model's reply is validated against the output contract and a
   citation check before it is ever stored, and the request and its outcome (`accepted`,
   `rejected` or `failed`) are kept append-only (`decisions/analyses-repository.ts`); an analysis
   of a suggestion ends with a verdict in words (ADR-0067). The user then records a decision
   (enter, do not enter, hold, adjust, exit) with a thesis and horizon; an open operation of the
   real portfolio takes hold, adjust or exit decisions, scored on the position held and its own
   fills once any expired option is settled (ADR-0022). At the horizon the engine scores the
   decision (#29, ADR-0005), and each analysis's outlook the same way (ADR-0058); the journal
   shows analyses under the decisions they informed, and the track record keeps the two apart,
   with a third, shared panel for how Fetha's own suggestions aged (ADR-0067) and a fourth, the
   user's own, for how the verdicts of Fetha's researches aged (flow 10, ADR-0076). A research
   is the one analysis of a set rather than an object: an "Obter sugestões" click, one call over
   the ideas the engine re-checked, counting one against the cap.
7. **Track the real portfolio.** Fills are entered by hand or imported from the B3 investor-area
   spreadsheet; they form positions; the user groups fills into operations; the engine marks
   everything to market and proposes exercise or expiry outcomes on expiry dates, which the user
   confirms or corrects. Only fills and operations are stored; positions and cash are derived
   from fills, and cash starts from the declared capital (ADR-0021).
8. **Read an asset without a strategy.** The watchlist and the asset page show the engine's
   reading of each asset (trend, RSI, daily range, implied volatility, option liquidity) with a
   closed label and a templated sentence, computed on each request, never stored, no AI
   (ADR-0059). The asset page lists the next steps: keep following, study an operation in the
   builder pre-filled with the ticker, or a starter recipe. A strategy stays optional; an active
   one adds the nightly evaluation and its signals.
9. **Read today's suggestions.** The home shows "Sugestões de hoje" (ADR-0067): each radar match
   the engine priced for one standard lot, in Fetha's own voice ("Uma trava de alta com calls em
   PETR4 cabe agora."), ordered by traded series, with the user's own risk-profile breaches
   computed on display. From a card or `/sugestoes/[id]` the user records enter or do not enter,
   requests an analysis with a verdict, tests the recipe through the recipe start flow (or opens
   the run already made for that ticker) or opens the builder prefilled with the lot. Nothing is
   sized to the user's capital until they decide; the suggestion itself is shared reference data,
   scored at expiry for everyone alike. A suggestion is open until the radar reads a newer close,
   then archived: it leaves today's suggestions and takes no new decision, still scored. While
   ingestion lags, today's suggestions stay with a warning of how many closes the radar has not
   read (ADR-0073). A user may also turn on, in Configurações › Aparência, the archive of seen
   suggestions with a delay of their choosing: Fetha then records when each card first shows on
   their screen, and once the delay has passed that suggestion is archived for them, listed
   apart as a link, still open for decisions (ADR-0074).
10. **Get suggestions on demand.** The "Sugestões de hoje" panel always carries "Obter sugestões"
    (ADR-0075): a Server Action that takes the radar's findings of its last 5 read sessions
    (deduplicated by underlying and recipe, newest wins), builds one market view per underlying at
    the newest close and re-runs the nightly scan's evaluation and one-lot pricing with the user's
    own risk profile (the form's defaults when none is declared, said on screen) and open
    operations. What still holds and what no longer does come back as two groups of cards with
    computed alerts (rule no longer holds, limit breach, near expiry); what could not be priced,
    expires in fewer than 5 sessions or loses more than the declared capital is only counted, by
    reason. The declared capital only drops ideas whose max loss exceeds it; it never sizes a lot.
    Rate limited per account, stops at about 45 s. When the user has a readable own Anthropic key
    and the cap allows it, one AI call over up to 20 ideas gives each a closed verdict (enter,
    wait, do not enter) and a justification (ADR-0076): the research and its ideas are stored,
    each idea takes a decision and opens the builder, and every idea, discarded ones included, is
    scored at its expiry and shown in the journal's "Pesquisas do Fetha". Without a key, or past
    the cap, the engine part shows alone with a notice line.

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
  re-deriving the boundary themselves. Not guaranteed by a single shared entry
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
- An `iv_rank` is read only when the `lookbackSessions` IV points it ranks all fall inside the
  window of sessions `dataWindow` requests for them; a session without a point, or a point not yet
  published, leaves it unread while it stays in the window; a D1 IV point's `asOf` is its session's
  close, like the candle's (ADR-0051).
- A daily candle is its session: a view holding two versions of one session reads the latest one
  visible at each instant, in the slot of the first; a catch-up evaluates each session once, as
  first published, and a restatement is read from its `asOf` on, never evaluated on its own
  (ADR-0055).
- Tenant isolation: every user-scoped table carries `user_id`; repositories take the user from
  the session. Exceptions, read-only to users: reference data (the radar's readings, matches,
  suggestions and suggestion scores included), the catalog and shared strategies.
- Fetha suggests but never ranks by an invented score and never executes: a suggestion's order on
  screen is a market fact (traded series), the AI analyses one suggestion on request and never
  ranks or orders them (it may give a closed verdict on the ideas of a research, ADR-0076), and
  every order is placed by the user at their broker (ADR-0003, ADR-0067).
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
the guided tour's dismissal kept as a per-user preference (0046), append-only, audited re-evaluation of one session (0047),
AI analyses over engine facts under a checked contract and a monthly cap (0057), analyses carrying
an outlook scored at its horizon (0058), the asset reading from engine defaults (0059), recipes as
shared strategy definitions chosen by expected move (0064), the nightly radar over liquid
underlyings (0066), and suggestions as priced radar matches spoken in direct voice and scored like
decisions, with the "not a recommendation" stance lifted by the owner (0067), and the Workspace
and Studio layouts with four themes carried over from Bardo and Mascate (0069), and the Dock
layout's floating menu (0071), a suggestion archived once the radar reads a newer close
(0073, superseding 0072), the per-user archive of seen suggestions (0074), and the
on-demand re-check of the radar's last 5 sessions against the user's risk limits (0075),
and the AI's closed verdict on each of its ideas, stored and scored (0076).
