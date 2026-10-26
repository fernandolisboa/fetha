# Fetha — Ubiquitous Language

The glossary. Every domain term used in code, tickets and UI copy has one entry: canonical name,
definition, rejected synonyms. Code, schema and copy use the canonical name (English in code,
its pt-BR translation in the UI). When a needed concept is missing here, that is a signal: either
the language is being invented or the glossary has a gap; resolve it in a grilling session, never
silently.

### Instruments and market data

**Instrument**:
Anything tradable on B3 that Fetha knows about: a stock, an ETF or a stock or index option.
Identified by its B3 ticker. A market index is not an instrument (below): it is never tradable,
only followed for its daily close.
_Avoid_: asset, paper, security, symbol

**Underlying**:
The stock, ETF or market index an option series is written on.
_Avoid_: base asset, spot

**Market index**:
A benchmark Fetha follows for its daily closing level alone, never traded: today, the Ibovespa
under `IBOV11` (the B3 registry's own join key for index options, ADR-0062), read nightly from
B3's own index service and stored as a close-only candle (`open = high = low = close`,
`tradedQuantity = 0`). Which tickers are market indexes is a code constant
(`market-data/market-index.ts`), checked at a handful of edges: no stock leg or stock fill may
name one, it never enters an evaluated strategy's universe, a backtest or the radar, and its level
is always shown in points, never `R$`.
_Avoid_: IBOV (B3's own index-service request code, distinct from the registry's `IBOV11`),
Ibovespa (the label), index points as a price

**Company filing**:
A document a listed company delivered to the CVM in one of four categories (material fact,
market notice, shareholder notice, shareholder meeting), identified by its protocol and version
and reached from an instrument through the company's CNPJ (ADR-0060). Shown as "Eventos
recentes" on the asset page; that title is UI copy, not the domain term.
_Avoid_: news, event, announcement

**Filing label**:
What the AI says one company filing is about, from closed lists: a topic, a tone for a
shareholder (positive, neutral, negative) and one pt-BR sentence with no figure (ADR-0065). A
filing ends labelled, rejected (the reply broke the contract) or unreadable, and that outcome is
never rewritten.
_Avoid_: sentiment score, rating, AI opinion

**News tone**:
GDELT's average tone of the Portuguese-language news matching a company's name or tickers, per
day, with the day's article count (ADR-0065). Experimental; the 30-day figure is weighted by
articles.
_Avoid_: sentiment index, buzz

**Option series**:
One listed option contract on an underlying: call or put, strike, expiry, exercise style. B3
reuses a ticker across listing cycles (ADR-0017), so a lookup by ticker alone (the Ctrl K search
and the series page, #241) means the cycle still alive today, the nearest expiry first, or the
most recently expired one when none is; the latest registry snapshot breaks a tie. A corporate
action on the underlying (a split, a bonus, a cash dividend) adjusts a series' strike without
changing its ticker or ISIN; the strike's own history is a **strike epoch** — the first instant a
listing cycle is known to have carried a given strike (ADR-0056), so the engine can see the strike
that was actually live at a given instant rather than only the latest one — bounded by what has
been ingested (ADR-0056's trade-offs): a strike never traded and never re-fetched by the registry
before an event has no epoch to recover it from. When a corporate action is recorded for the
underlying, an epoch the backfill dated before that event is not visible until the ex-date's open
(ADR-0056 #272 addendum).
_Avoid_: option contract, series code, option ticker (that is its identifier, not the concept)

**Price factor**:
An index option's own quotation unit (index points, e.g. Ibovespa) per real of premium as
stored (B3's registry `PricFctr`; ADR-0063) — absent for every equity option, which is quoted
and priced in reais directly. Spot and strike stay in the series' own quotation unit (points
for an index option, reais for an equity option) regardless; the price factor converts only
where a premium or a model value meets them, never the strike or spot themselves.
_Avoid_: quotation factor (that is COTAHIST's own `FATCOT`, a distinct, row-level lot-grouping
divisor applied to a price field at ingestion, not this series-level field)

**Settlement style**:
How an option series' in-the-money leg settles at expiry: `"physical"` (absent; the underlying
changes hands at the strike, every equity option) or `"cash"` (B3's rule for every index option,
e.g. Ibovespa — there is no underlying to deliver, so the leg settles for its intrinsic value in
cash instead). A series with a price factor other than 1 must be cash-settled; never inferred
from the price factor itself, a separate, registry-sourced fact (ADR-0063).
_Avoid_: settlement (that is the event — `proposeSettlement`, `LegSettlement` — not this
series-level field, named `settlementStyle` precisely to keep the two apart)

**Chain**:
The set of option series listed on one underlying on a given day, with their quotes.
_Avoid_: option board, grade de opções

**Candle**:
The open, high, low, close and traded quantity (count of shares or contracts) of an instrument
over one timeframe interval: a trading session (daily) or an intraday interval of 15, 30 or 60
minutes. Stored and exchanged in nominal form; the adjusted form is derived.
_Avoid_: bar, OHLC, quote history, volume (ambiguous between quantity and financial value)

**Restatement**:
A later version of a daily candle for the same session, published with a later `asOf` (a corrected
COTAHIST file, a late adjustment). A daily candle is identified by `(ticker, session)`: from its own
`asOf` on, the restatement replaces the earlier version in the session's place, and it is never an
evaluation instant of its own (ADR-0055). Intraday candles have none: two bars of one session are
two candles.
_Avoid_: revision, correction, updated candle

**Timeframe**:
The interval a candle, an indicator or a strategy is defined on: `15m`, `30m`, `60m` or `D1`.
_Avoid_: resolution, interval, period (reserved for the backtest date range)

**Reference data**:
Market data shared by all users and read-only to them: daily candles, option series, daily
option prices, corporate-action factors, macro series, the trading calendar and the
implied-volatility index, ingested from public B3 and Bacen sources or, for the
implied-volatility index, computed nightly from the others (no adapter, ADR-0054), except
corporate-action factors, which the owner types by hand on `/configuracoes` from each company's
own public notice (#50, ADR-0052) since no licensed automatic source exists yet; the table is
still read by the engine like every other reference collection (ADR-0013).
_Avoid_: shared data, public data

**Intraday tier**:
Live quotes, chain and intraday candles fetched from a paid provider with a token the user
supplies. Optional per user: without a token Fetha works on reference data only. Data fetched
with a user's token is cached for that user alone.
_Avoid_: real-time feed, premium data, live data

**Trading session**:
One B3 business day according to the trading calendar.
_Avoid_: trading day, pregão (in code)

**Trading calendar**:
The list of B3 holidays and special sessions (ingested from the ANBIMA holiday file and B3
notices) that determines which days are trading sessions and their hours.
_Avoid_: holiday list, business calendar

**Corporate-action factor**:
The multiplier applied to earlier prices and quantities of an instrument to compensate for a
split, reverse split or bonus, so that a series stays comparable across the event. Entered by the
owner on `/configuracoes` from the company's own public notice, one ticker and ex-date at a time
(#50, ADR-0052); applied by the engine point in time, so a factor is invisible to any computation
dated before its ex-date session open (ADR-0013). A factor of `1` is the owner's own way to
neutralize a mistaken entry (there is no delete) and is kept out of every collection the engine
reads, though the row itself, and its write-time `recorded_at`, stay in storage.
_Avoid_: adjustment ratio, FATCOT (that is the COTAHIST field, not the concept)

**Dividend protection**:
B3 lowers the strike of every listed option on an underlying by each cash distribution (dividend,
JCP), rounded to the cent, on its ex-date, so the payment neither helps nor hurts the option
holder. The engine therefore prices B3 options with dividend yield `q = 0` by design (ADR-0070);
the strike change itself is a strike epoch (ADR-0056).
_Avoid_: dividend adjustment (ambiguous with an adjusted series)

**Adjusted series / nominal series**:
The two forms of an instrument's candle history: nominal keeps the prices as traded and is the
basis for option strikes, prices, fills and settlement; adjusted is derived by the engine from
the nominal series and the corporate-action factors visible at the evaluation instant, and is
the default for charts, indicators and conditions.
_Avoid_: raw series, unadjusted, real prices

**Macro series**:
A reference rate or index published by Bacen and used as risk-free rate or benchmark: CDI, Selic,
IPCA.
_Avoid_: indicator (reserved for technical indicators), rate

**Exchange rate (PTAX)**:
Bacen's own daily fixing for a currency pair against the real (USD/BRL, EUR/BRL), the "venda"
(selling) rate, published around 1pm on Bacen's own business-day calendar — not a B3 trading-
session close and not a macro series (ADR-0061). Shared, read-only reference data like the macro
series, but tracked for its own sake (findable, charted), never as a strategy input, a backtest
instrument or an option underlying.
_Avoid_: FX rate, currency quote, dollar price

### Structures and strategies

**Structure**:
A template for a multi-leg options operation: an ordered list of legs described relatively
(buy call at the lower strike, sell call at the higher strike, same expiry), with no ticker,
strikes or dates. Collar, trava de alta com calls, butterfly and box spread are structures. A single stock
purchase is the trivial structure with one stock leg.
_Avoid_: strategy (that is a rule, not a shape), setup, combo, montagem

**Leg template**:
One component of a structure, described relatively: an instrument role (stock, call or put), a
side (buy or sell), a quantity ratio and, for option roles, a strike rank that orders the
structure's strikes ascending (legs sharing a rank share a strike, as in a straddle).
_Avoid_: abstract leg, leg spec

**Leg**:
A leg template instantiated: role, side, a concrete instrument (stock or option series) and a
quantity; with an entry price once it belongs to an operation.
_Avoid_: ponta (in code), position (a leg is not a position)

**Strategy**:
A declarative, versioned decision rule: when to enter, which structure to enter with, how to
size, when to exit or adjust. Strategies are data, backtestable and comparable; they are never
code.
_Avoid_: system, algorithm, playbook, bot

**Strategy version**:
One immutable revision of a strategy definition. Backtests, signals and decisions reference a
version, never a mutable strategy.
_Avoid_: strategy snapshot, revision

**Active strategy**:
A strategy flagged for the nightly evaluation (daily strategies) or catch-up evaluation
(intraday strategies) over the owner's watchlist. The flag lives on the strategy, not one
version: flipping it takes effect the next evaluation using whatever version is latest then, the
same way the editor always edits the latest version.
_Avoid_: enabled strategy, running strategy, live strategy

**Archived strategy**:
A strategy the owner marked out of active use (docs/adr/0043): read-only, deactivated, excluded
from the per-user strategy cap and from sharing, and refused as the target of a new backtest run.
Its versions, runs, signals and decisions stay reachable; unarchiving restores it, re-checked
against the same cap a new strategy would face. Never deleted.
_Avoid_: deleted strategy, disabled strategy (that is the unrelated `active` flag)

**Catalog**:
The shared, read-only library of structures and reference strategies available to every user.
Each entry is a structure with its published source and a default strike and expiry selection;
that default selection is what makes it a reference strategy (docs/adr/0053).
_Avoid_: library, templates

**Recipe**:
A complete, shared, read-only strategy definition (entry, structure, strikes, expiry, sizing,
exits) chosen by the expected move it serves and the IV regime it enters on (ADR-0064). A user
copies one into their own strategies in one click from the asset page; the copy is an ordinary
strategy. The radar and suggestions match recipes, not copies. Shown as "receita".
_Avoid_: template, preset, reference strategy (that is a catalog entry's default selection)

**Radar** (pt-BR: _Radar_):
The nightly, shared read of every liquid optionable underlying against the recipes (ADR-0066):
its universe is the underlyings with an IV index point on the session whose options traded on at
least 17 of the last 21 sessions. A recipe "found an entry" on an underlying when its entry
condition held at the close and one unit of its structure resolves to listed series. A match the
engine fully prices for one standard lot becomes a suggestion (ADR-0067). Shown as a tab of the
watchlist page; reference data, never a user's strategy.
_Avoid_: screener, scanner, ranking, suggestion (that is the priced match, its own entry)

**Suggestion** (pt-BR: _Sugestão_):
A radar match made concrete and spoken in Fetha's own voice ("Uma trava de alta com calls em
PETR4 cabe agora.", ADR-0067): the structure one B3 standard lot (100 units per ratio unit)
resolves to on the scanned session's closing chain, the engine's pricing of it, a thesis claim
(`close_above`/`close_below` its single break-even, or `operation_pnl_positive`) and a horizon, the
options' shared expiry. Exists only when every leg was priced, the max loss is bounded and the
options share one expiry. Shared reference data written by the nightly scan, the same for every
user, ordered by traded series, never by a score; a user's risk-profile breaches on it are
computed when shown. A user answers it with a decision (enter / do not enter), may request an
analysis of it, test its recipe or open it in the builder. Scored at its horizon like a decision,
as the lot entered at the engine's prices, with its confidence asserted. The AI never picks or
ranks suggestions. Open through the São Paulo day of the trading session after its close, then
archived (pt-BR: _arquivada_): off today's suggestions, no new decision, still scored (ADR-0072).
Archived here follows from the date alone, never a user action, unlike an archived strategy.
_Avoid_: recommendation, tip, idea (in code, except the suggestion research's own idea below), pick, match (the radar row before pricing)

**Suggestion research** (pt-BR: _Pesquisa de sugestões_, the button "Obter sugestões"):
The on-demand, per-user re-check of what the radar found over its last 5 read sessions (ADR-0075).
Each finding, deduplicated by underlying and recipe with the newest kept, is evaluated again at
the newest close with the nightly scan's own code and priced for one standard lot against the
user's risk profile (the risk form's default one when none is declared, said on screen). It
returns two groups of **ideas**, the re-priced findings (pt-BR: _ideias_): the ones that still
hold today and the ones whose rule no longer does, each with computed alerts (the rule no longer
holds, a limit breach, near expiry), plus a count of what was dropped by reason (no price,
expires in fewer than 5 sessions, max loss above the declared capital). An idea is not a
suggestion: it is not stored, has no id and takes no decision until part 2 of #356 stores it.
Computed on each click, rate limited, never ordered by a score.
_Avoid_: screener, scan, new suggestions, recommendation, refresh

**Expected move**:
What the user expects an instrument to do when choosing a recipe: `up`, `down`, `sideways` or
`big_move` (either way). Stated by the user; a recipe only maps it to a structure.
_Avoid_: view, market view (MarketView is the engine's data snapshot), outlook (an analysis's
scored claim), thesis

**IV regime**:
The implied-volatility condition a recipe enters on: `low` (the DSL's `iv_rank` over 63
sessions below 50, i.e. IV below its own median for the quarter), `high` (at or above 50) or
`any`, from the sign of the structure's vega (ADR-0064). `iv_rank` is a percentile, not the
min–max IV rank.
_Avoid_: volatility view, vol regime

**Shared strategy**:
A user's strategy made visible, read-only, to every registered user, who may copy it into their
own space. Sharing is by visibility, not by invitation.
_Avoid_: published strategy, community strategy, public strategy

### Signals and watchlist

**Watchlist**:
The tickers a user follows: instruments and, since ADR-0062, a market index. Active strategies
are evaluated only over the user's watchlist. A watchlist may hold a market index, for following
its level alone: a market index is not an instrument, and is excluded wherever the watchlist
feeds a strategy, a backtest or the radar.
_Avoid_: universe (reserved for backtests), favorites, radar

**Signal**:
An evaluation of one strategy version on one instrument at one evaluation time whose outcome is
actionable: an entry condition met with a priced proposal, or an exit or adjustment condition
met on an open operation; with the indicator values that fired. A signal waits in the user's
inbox until a decision answers it. Every evaluation produces an evaluation record; only these
outcomes also produce a signal, and an entry from a session older than the inbox horizon
(ADR-0044) produces none.
_Avoid_: alert, trigger, recommendation, setup, suggestion (that comes from the radar and the
recipes, not from the user's own strategy)

**Proposal**:
The sized, priced set of legs an entry signal carries: quantities and an `OperationPricing`
(spot, greeks, payoff, break-evens, max loss/gain, limit breaches). Produced by the engine
(`priceOperation` or `evaluateStrategy`'s own stock-leg pricing), never by the AI; a decision
either enters it as-is or is answered `do_not_enter`.
_Avoid_: quote, order, ticket

**Evaluation record**:
The outcome of one evaluation of one strategy version on one instrument at one evaluation time:
a signal, conditions not met, no series match, degenerate strikes, insufficient data or
unsizeable; with a reason, a stable code identifying why (ADR-0013's #80 addendum). A row the
engine never got to evaluate at all (its structure was deleted from the catalog, an engine error,
a clamped catch-up, an unfillable market-data collection, or a market view `apps/web` itself
could not load — too many option series to load in one call, or no market data at all for the
window) carries one of `apps/web`'s own web-authored reason codes instead (ADR-0039). An entry the
engine did evaluate as a signal, but whose session is past the inbox horizon, keeps its `signal`
outcome and has its reason replaced by the web-authored `entry_past_inbox_horizon` (ADR-0044).
Visible in the evaluation log, never in the inbox.
_Avoid_: signal (reserved for the actionable outcomes), evaluation log entry, detail (removed from
the engine's own `EvaluationRecord`, ADR-0039; `detail` survives only as a plain log column)

**Inbox horizon**:
How many of the newest trading sessions, counted back from the wall clock, a nightly catch-up may
send entry signals from: five (ADR-0044). Separate from the catch-up limit (21 sessions), which bounds how far back evaluation
and the log reach.
_Avoid_: signal expiry, freshness window

**Re-evaluation**:
Recomputing one strategy on one session it was already evaluated on, after its market data was
corrected, triggered by the user from the evaluation log (ADR-0047). Append-only: a changed
evaluation record or proposal is superseded by a new row, a signal the result no longer carries is
retracted, and an unchanged proposal keeps its row and read state. Only an authoritative result
changes anything; every attempt, failed or not, is recorded in the audit trail.
_Avoid_: re-run, force, recompute, backfill

**Evaluation time**:
The moment a strategy's conditions are computed against the data available then: the close of a
trading session for daily strategies, the close of each candle for intraday strategies.
_Avoid_: run time, tick

**Catch-up evaluation**:
Evaluating an intraday strategy over the candles that closed while the app was not in use, when
it is opened again. Signals found this way are marked late.
_Avoid_: backfill, replay

**Missed entry**:
An entry signal in a backtest that produced no operation, with the sessions tried and one
reason: no trades in the selected series in the fill session and the following sessions (up to
three while the condition held); a risk-profile limit refused it (enforce mode); no listed
series matched the selection at the attempt's session; two strike ranks collapsed onto one
strike (degenerate strikes); or the sizing rule yielded no units (unsizeable). Never filled
retroactively (ADR-0014).
_Avoid_: skipped trade, failed fill, rejected order

### Operations and portfolio

**Operation**:
A structure instantiated for real or in simulation: concrete underlying, option series, strikes,
expiry, quantities, entry prices and entry date. It has a lifecycle: open, adjusted, closed or
expired. A rolled operation is a new operation that records which operation it rolled from.
_Avoid_: trade (reserved for a single fill), position, order, montagem, operação (in code)

**Contemplated operation**:
A priced structure snapshot the builder saves before a decision is made: the structure, the
underlying, the legs the user picked, the engine's valuation at the moment of pricing (net
premium, max loss, max gain, any limit breaches) and the session it was priced in. Distinct from
an Operation: it carries no lifecycle and no fills, and saving one does not open a position.
_Avoid_: operation, draft, simulation

**Held operation**:
An open operation of the real portfolio whose expiry session has not closed, as the user sees it
in `/carteira`: its legs at average cost and the fills behind them. The one kind of operation a
hold, adjust or exit decision is recorded on (ADR-0022). One pending settlement is no longer held.
_Avoid_: position (one instrument only), open trade

**Fill**:
One executed buy or sell of one instrument at one price and quantity, on one date. Fills are the
atomic facts behind operations and positions.
_Avoid_: trade, execution, order

**Position**:
The net quantity a user currently holds in one instrument, with its average cost, as the result
of all fills in that instrument. Signed: positive when net long, negative when net short (a
written option); never zero, since a closed position is no position. An option position is per
series (ticker and expiry), since B3 reuses option tickers across listing cycles. Derived from
fills on read, never stored (ADR-0021).
_Avoid_: holding, exposure, custody

**Portfolio**:
All of a user's open positions and open operations, marked to market with the latest data, plus
cash.
_Avoid_: account, wallet, carteira (in code)

**Mark to market**:
Valuing positions and operations at the latest available prices from ingested data.
_Avoid_: revaluation, current value

**Settlement proposal**:
The engine's proposed outcome for each leg of an operation at its expiry: exercised or assigned
when in the money at the expiry close by any amount, expired worthless otherwise, kept for stock
legs; with the fills that outcome implies. The user confirms or corrects; nothing settles on its
own.
_Avoid_: auto-exercise, expiry processing, liquidação (in code)

**Fills import**:
Loading a user's executed trades from the "Negociação" spreadsheet exported by B3's investor
area, which produces fills for any broker. Re-importing the same rows adds nothing; exercise rows
are skipped, since confirmed settlements are the one source of exercise fills (ADR-0021).
Brokerage notes are a later import source.
_Avoid_: sync, broker integration (there is none)

### Backtesting

**Backtest run**:
One deterministic execution of a strategy version over a universe of instruments, a period, an
initial capital, a cost model and a sizing rule. It stores its frozen configuration, the
simulated operations and fills, the daily equity curve and the metrics. Runs are immutable;
running again creates a new run.
_Avoid_: simulation, test, replay

**Checkpoint**:
The paused state of a backtest run that has not yet reached `period.to`: a `configDigest` tying
it to the exact config that produced it, a cursor session and everything the run needs to resume
from there. Depends only on rows visible by the cursor session's close (ADR-0013's I7), so a
chunked run and one uninterrupted call over the same period agree (I2). Valid only for the
`configDigest`, `engineVersion` and checkpoint schema that produced it; any of those mismatching
is `checkpoint_mismatch`. Calendar identity across chunks is a separate concern the engine does
not check: the caller (`run-chunk.ts`) reloads the calendar on every chunk and compares its own
`calendarVersion` stamp, failing with `data_version_changed`, not `checkpoint_mismatch`, on a
revision (ADR-0013's #90 addendum).
_Avoid_: snapshot, save state, resume token

**Universe**:
The set of instruments a backtest run evaluates the strategy over. The radar's universe (ADR-0066)
is a different, global set: the liquid optionable underlyings it reads nightly.
_Avoid_: watchlist (that is the live list), basket

**Cost model**:
The fees and taxes a backtest run charges on simulated fills: B3 fees, brokerage, income tax on
monthly net gains, plus slippage on option fills.
_Avoid_: fee schedule, commissions

**Equity curve**:
The daily series of the simulated portfolio value during a backtest run.
_Avoid_: PnL curve, balance history

**Warm-up**:
The leading run of period sessions before the strategy's own indicators have enough history to
evaluate a single instrument in the universe (`insufficient_data` on every instrument). It is
structurally dead: the strategy could not have traded it no matter what the data said, so it is
excluded from every backtest metric — from `cagr`'s elapsed clock as well as from the observed
count, since capital sitting in cash during it is not elapsed track record (ADR-0041).
_Avoid_: lookback period, burn-in

**Observed session**:
A period session that carries at least one universe candle and falls on or after the strategy's
first tradable session (the session warm-up ends). `metrics.sessions`, `sharpe`, `exposure` and
the annualization threshold are computed over this subsequence only; a session with no candle for
any universe ticker (an interior gap: a halted ticker, a staggered listing in a multi-ticker
universe) is excluded the same way warm-up is, since the strategy never saw it either. `cagr`'s
exponent, `maxDrawdown` and `totalReturn` instead read every post-warm-up session, gaps included,
since calendar time and cash movement are real even where no candle was observed (ADR-0041).
_Avoid_: tradable session, active session

**Walk-forward**:
The per-window view of a backtest run: the period cut into consecutive windows of a fixed number
of sessions, with the run's metrics reported per window next to the whole-run metrics, so that
instability over time is visible. No optimization and no out-of-sample test in v1 (ADR-0014);
an operation belongs to the window where it opened. The window length is chosen when the run is
created (ADR-0023).
_Avoid_: out-of-sample test, optimization window, anchored walk-forward

**Comparison**:
Two or three completed backtest runs side by side: their setup, whole-run metrics, cumulative
return curves and per-window returns, read from the persisted runs (ADR-0023). The runs may be
versions of one strategy or different strategies.
_Avoid_: benchmark, tournament, optimization

### Risk

**Risk profile**:
A user's declared capital for operations and their limits: max loss per operation, max
exposure per operation, max open operations, max option premium bought, all as fractions of
that capital.
_Avoid_: risk settings, limits (alone), appetite

**Declared capital**:
The amount of money a user states they dedicate to the operations modeled in Fetha. It is
entered and edited by the user; Fetha never reads it from a bank or broker.
_Avoid_: balance, net worth, account value, allocated capital

**Sizing rule**:
How a strategy or a user turns a structure into a quantity: fixed fractional (a fraction of
declared capital) or fixed risk (a max-loss budget divided by the structure's max loss).
_Avoid_: position sizing (as a noun for the rule), lot size, money management

**Limit breach**:
An operation whose size exceeds a risk-profile limit. A backtest run refuses it unless the run is
configured to only warn; on screen the user is warned and may record the decision anyway, with
the breach noted.
_Avoid_: violation, error

### Pricing and risk

**Fair value**:
The engine's theoretical price of an option series under the pricing model (Black-Scholes-Merton
with continuous dividend yield), given spot, strike, time to expiry, risk-free rate, dividend
yield and volatility.
_Avoid_: theoretical price, model price, fair price

**Implied volatility**:
The volatility that makes the pricing model's fair value equal to the market price of an option
series.
_Avoid_: IV (fine as an abbreviation in UI), vol

**Implied volatility index**:
One number per underlying per trading session summarizing its implied volatility: the
at-the-money implied volatility for thirty calendar days, interpolated between the two nearest
expiries. Computed by the engine from the chain, persisted with reference data and the input of
`iv_rank`.
_Avoid_: VIX (a specific index), IV surface, vol level

**Asset reading** (pt-BR: _Leitura do ativo_):
A deterministic engine snapshot of one ticker at an instant: trend (up/down/sideways from SMA
50/200), momentum (oversold/neutral/overbought from RSI 14), range (calm/normal/wide from ATR 14
as a share of close), implied volatility (low/normal/high from its IV rank) and option liquidity
(liquid/thin/none from traded series), each labeled from this project's own default thresholds
(ADR-0059). No AI involved; "not enough data" is a null label, never an error.
_Avoid_: snapshot, overview, summary

**Greeks**:
The sensitivities of an option's fair value: delta, gamma, theta, vega, rho. Computed per leg and
aggregated per operation and per portfolio.
_Avoid_: sensitivities, risk parameters

**Payoff**:
The profit or loss of a structure or operation at expiry as a function of the underlying price,
including the net premium paid or received.
_Avoid_: P&L diagram, profit curve

**Max loss / max gain**:
The worst and best payoff of an operation at expiry over all underlying prices; unbounded when
the structure has naked exposure.
_Avoid_: risk, reward, downside, upside

**Break-even**:
An underlying price at which the payoff of an operation is zero.
_Avoid_: zero point, ponto de equilíbrio (in code)

### Decisions

**Decision**:
An explicit record by the user about an operation, existing, contemplated or suggested: enter, do
not enter, hold, adjust (including roll) or exit; with date, rationale, a thesis and, optionally,
the analysis that informed it. "Do not enter" is a first-class decision. A decision on an
existing operation of the real portfolio (hold, adjust or exit) is scored on the position held
when it was taken and the fills that followed (ADR-0022). A decision on a suggestion (enter or do
not enter, one per user per suggestion) snapshots the lot as shown and is scored on it
(ADR-0067).
_Avoid_: action, choice, trade idea, entry, order

**Thesis**:
The falsifiable expectation behind a decision: what the user believes will happen, by when, and
what would invalidate it.
_Avoid_: view, idea, bet, rationale (that is the free-text reasoning)

**Thesis claim**:
The optional machine-checkable part of a thesis, from a closed vocabulary: the instrument closes
above or below a level at the horizon, or the operation's P&L is positive at the horizon. The
engine decides whether it held; a thesis without a claim is scored on P&L only.
_Avoid_: prediction, target, condition (reserved for strategy rules)

**Analysis**:
One AI-produced reasoning artifact over engine output for a signal, a contemplated operation, a
held operation, a backtest run or a suggestion: thesis, counter-thesis, key risks, max loss,
break-evens, invalidation conditions and confidence with justification, always citing the engine
inputs it used (ADR-0057). Requested on demand, never automatically, up to a monthly cap per user
(default 50); every request and its outcome (`accepted`, `rejected` or `failed`) is stored
append-only with the prompt version and the model that answered. From `analysis@2` on, an
analysis may carry an outlook, scored at its horizon (ADR-0058); from `analysis@3` on, an
analysis of a suggestion ends with a verdict (ADR-0067).
_Avoid_: recommendation, report, insight, opinion

**Verdict** (pt-BR: _Veredito_):
The closing field of an analysis of a suggestion (`analysis@3`, ADR-0067): `enter`, `wait` or
`do_not_enter`, a word from a closed list with a justification in prose, never a number. Required
on a suggestion's analysis and forbidden on every other subject's; its justification goes through
the same citation check as the rest of the reply. A verdict is read, not executed: the decision
stays the user's.
_Avoid_: recommendation, rating, score, signal, call

**Model family**:
Haiku, Sonnet or Opus — the only three choices a user can pick per analysis kind under
Configurações (ADR-0068), each resolved at request time to that family's newest Anthropic release,
never older than a pinned floor. A kind with no stored choice uses its own default family
(`@fetha/prompts`' `defaultAnalysisFamilies`, the same Opus/Sonnet split ADR-0009 set). Distinct
from the literal model id that answered a request, which is still what is stored on the analysis.
_Avoid_: model version, model id (the resolved id, not the family, is the id)

**Outlook**:
The verifiable part of an analysis (ADR-0058): a ticker closing above or below a price level at a
horizon (one week, one month or three months of sessions, or the expiry), with a likelihood
(`somewhat_likely`, `likely`, `very_likely`) that a fixed table turns into the claim's confidence.
The model names the ticker and the level by fact path and writes no figure; the app turns the
outlook into a thesis claim, and the engine scores it like a decision's, on the claim alone.
_Avoid_: forecast, target, prediction (in code)

**Journal**:
The chronological record of a user's decisions and accepted AI analyses, each later scored against
realized outcomes. An analysis sits under the decision it informed; the track record keeps
decision scores and analysis scores apart (ADR-0058), and a third panel, "Sugestões do Fetha",
shows how the app's own suggestions aged (hit rate and P&L per lot, per recipe), shared and the
same for every user (ADR-0067).
_Avoid_: history, log, diary

**Horizon**:
The date at which a decision is scored: the date stated in its thesis or, by default, the
expiry of its operation. For an analysis's outlook (ADR-0058), the session resolved at acceptance
from `one_week`, `one_month`, `three_months` (5, 21, 63 sessions) or `expiry` against the trading
calendar. For a suggestion, the options' shared expiry (ADR-0067).
_Avoid_: deadline, due date, target date

**Score**:
The evaluation of a decision, an analysis or a suggestion at its horizon: realized P&L normalized
by max loss, whether the thesis held (crossed with the stated confidence, Brier-style; a
suggestion asserts its claim at confidence `1`, so only its hit rate is shown), and, for "do not
enter", the counterfactual P&L of the operation not taken.
_Avoid_: grade, rating, performance

**Counterfactual P&L**:
The profit or loss an operation would have produced had it been entered, computed with the
backtest fill model.
_Avoid_: missed profit, opportunity cost, what-if

### Accounts and access

**User**:
One registered account and the tenant that scopes every domain table (`user_id`). Fetha has no
households or shared workspaces (ADR-0016).
_Avoid_: account, tenant (in code), member

**Owner**:
An account whose email is listed in `OWNER_EMAILS`, verified. An operator capability over a
system job (the manual re-run of the nightly ingestion, ADR-0042) and over recording
corporate-action factors on `/configuracoes` (#50, ADR-0052), not a tenancy or data-access role —
it grants no read or write on another user's rows, and the app otherwise has no roles (ADR-0016).
Distinct from "user"/"tenant": ordinary multi-user isolation is unaffected.
_Avoid_: admin, superuser, role

**Invite**:
An email address the owner has cleared to register while `REGISTRATION_MODE=invite`; consumed
when someone proves they own that mailbox (verification link, magic link or password reset), not
at sign-up (ADR-0029). Not scoped to a user: it has none until consumed.
_Avoid_: invitation code, whitelist entry

**Terms acceptance**:
The record that a user accepted the terms of use and privacy policy, with the version accepted
and the timestamp. Append-only: a later terms version adds a new row, never overwrites one. The
`user` row's own `terms_version`/`terms_accepted_at` is the current consent of record; it is NULL
on a verified account whose owner has not accepted yet (docs/adr/0036), which the re-acceptance
gate (`/aceitar-termos`) blocks the shell on.
_Avoid_: consent, agreement

**Magic link**:
A one-time, time-limited link that signs an existing, already-registered user in without a
password. Sign-in only: clicking it never creates a new account, so it cannot be used to bypass
terms/privacy acceptance or `REGISTRATION_MODE` (ADR-0018). pt-BR: "link mágico".
_Avoid_: passwordless login, one-time login link

**Access log**:
The per-user record of each read or export of that user's portfolio and decision data: when,
which event, from which IP address and device. Kept 180 days and shown under Configurações
(ADR-0027). pt-BR: "registro de acesso".
_Avoid_: audit trail (in copy), activity feed, history

**Nightly run report**:
The redacted, per-run record (`nightly_runs`) of the nightly job's own purge → ingest → evaluate →
score sequence: one row per run, cron or manual, with counts and closed-vocabulary statuses only —
never a user id, decision id, email or raw provider/engine error string. Operational, system-written,
not user-facing; kept 90 days (ADR-0045).
_Avoid_: run log, job history (in code; these are not user-visible)

**Account deletion**:
The user's own, immediate and final removal of their account and every row tied to it, confirmed
with their password (ADR-0027). There is no grace period and no recovery. pt-BR: "excluir conta".
_Avoid_: deactivation, closing the account, soft delete

**Unverified account**:
A registered account whose email has not been confirmed yet. It has no password anyone chose (the
sign-up form asks for none), cannot sign in and owns no data; opening its verification link signs
the mailbox owner in to choose the password. Deleted 24 hours after creation if still unverified
(ADR-0028). pt-BR: "conta não confirmada".
_Avoid_: pending user, unconfirmed user

**Password reset**:
The flow that lets a user set a new password after proving control of their email through a
one-time link, revoking every session that predates the reset (ADR-0018). Completing it also marks
the account's email verified, since the link reached the mailbox (ADR-0028).
_Avoid_: forgot password, password recovery
