# Fetha — Ubiquitous Language

The glossary. Every domain term used in code, tickets and UI copy has one entry: canonical name,
definition, rejected synonyms. Code, schema and copy use the canonical name (English in code,
its pt-BR translation in the UI). When a needed concept is missing here, that is a signal: either
the language is being invented or the glossary has a gap; resolve it in a grilling session, never
silently.

### Instruments and market data

**Instrument**:
Anything tradable on B3 that Fetha knows about: a stock, an ETF or a stock option. Identified by
its B3 ticker.
_Avoid_: asset, paper, security, symbol

**Underlying**:
The stock or ETF an option series is written on.
_Avoid_: base asset, spot

**Option series**:
One listed option contract on an underlying: call or put, strike, expiry, exercise style.
_Avoid_: option contract, series code, option ticker (that is its identifier, not the concept)

**Chain**:
The set of option series listed on one underlying on a given day, with their quotes.
_Avoid_: option board, grade de opções

**Candle**:
The open, high, low, close and traded quantity (count of shares or contracts) of an instrument
over one timeframe interval: a trading session (daily) or an intraday interval of 15, 30 or 60
minutes. Stored and exchanged in nominal form; the adjusted form is derived.
_Avoid_: bar, OHLC, quote history, volume (ambiguous between quantity and financial value)

**Timeframe**:
The interval a candle, an indicator or a strategy is defined on: `15m`, `30m`, `60m` or `D1`.
_Avoid_: resolution, interval, period (reserved for the backtest date range)

**Reference data**:
Market data shared by all users and read-only to them: daily candles, option series, daily
option prices, corporate-action factors, macro series and the trading calendar, ingested from
public B3 and Bacen sources. Corporate-action factor recording from labeled events is tracked
as a follow-up (#50, ADR-0017); the table exists and is read by the engine (ADR-0013) but no
current ingestion source writes to it.
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
split, reverse split, bonus or dividend, so that a series stays comparable across the event.
Recorded by ingestion with its ex-date; applied by the engine point in time, so a factor is
invisible to any computation dated before its ex-date session open (ADR-0013).
_Avoid_: adjustment ratio, FATCOT (that is the COTAHIST field, not the concept)

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

### Structures and strategies

**Structure**:
A template for a multi-leg options operation: an ordered list of legs described relatively
(buy call at the lower strike, sell call at the higher strike, same expiry), with no ticker,
strikes or dates. Collar, trava de alta, butterfly and iron condor are structures. A single stock
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

**Catalog**:
The shared, read-only library of structures and reference strategies available to every user.
_Avoid_: library, templates

**Shared strategy**:
A user's strategy made visible, read-only, to every registered user, who may copy it into their
own space. Sharing is by visibility, not by invitation.
_Avoid_: published strategy, community strategy, public strategy

### Signals and watchlist

**Watchlist**:
The list of instruments a user follows. Active strategies are evaluated only over the user's
watchlist.
_Avoid_: universe (reserved for backtests), favorites, radar

**Signal**:
An evaluation of one strategy version on one instrument at one evaluation time whose outcome is
actionable: an entry condition met with a priced proposal, or an exit or adjustment condition
met on an open operation; with the indicator values that fired. A signal waits in the user's
inbox until a decision answers it. Every evaluation produces an evaluation record; only these
outcomes also produce a signal.
_Avoid_: alert, trigger, recommendation, setup

**Proposal**:
The sized, priced set of legs an entry signal carries: quantities and an `OperationPricing`
(spot, greeks, payoff, break-evens, max loss/gain, limit breaches). Produced by the engine
(`priceOperation` or `evaluateStrategy`'s own stock-leg pricing), never by the AI; a decision
either enters it as-is or is answered `do_not_enter`.
_Avoid_: quote, order, ticket

**Evaluation record**:
The outcome of one evaluation of one strategy version on one instrument at one evaluation time:
a signal, conditions not met, no series match, degenerate strikes, insufficient data or
unsizeable; with a detail. Visible in the evaluation log, never in the inbox.
_Avoid_: signal (reserved for the actionable outcomes), evaluation log entry

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

**Fill**:
One executed buy or sell of one instrument at one price and quantity, on one date. Fills are the
atomic facts behind operations and positions.
_Avoid_: trade, execution, order

**Position**:
The net quantity a user currently holds in one instrument, with its average cost, as the result
of all fills in that instrument. Signed: positive when net long, negative when net short (a
written option); never zero, since a closed position is no position.
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
Loading a user's executed trades from the spreadsheet exported by B3's investor area, which
produces fills for any broker. Brokerage notes are a later import source.
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
`configDigest`, `engineVersion` and checkpoint schema that produced it, and only when resumed
with the same calendar the run started with; anything else is `checkpoint_mismatch`.
_Avoid_: snapshot, save state, resume token

**Universe**:
The set of instruments a backtest run evaluates the strategy over.
_Avoid_: watchlist (that is the live list), basket

**Cost model**:
The fees and taxes a backtest run charges on simulated fills: B3 fees, brokerage, income tax on
monthly net gains, plus slippage on option fills.
_Avoid_: fee schedule, commissions

**Equity curve**:
The daily series of the simulated portfolio value during a backtest run.
_Avoid_: PnL curve, balance history

**Walk-forward**:
The per-window view of a backtest run: the period cut into consecutive windows of a fixed number
of sessions, with the run's metrics reported per window next to the whole-run metrics, so that
instability over time is visible. No optimization and no out-of-sample test in v1 (ADR-0014);
an operation belongs to the window where it opened.
_Avoid_: out-of-sample test, optimization window, anchored walk-forward

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
An explicit record by the user about an operation, existing or contemplated: enter, do not
enter, hold, adjust (including roll) or exit; with date, rationale, a thesis and, optionally,
the analysis that informed it. "Do not enter" is a first-class decision.
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
One AI-produced reasoning artifact over engine output for a structure, operation or signal:
thesis, counter-thesis, key risks, max loss, break-evens, invalidation conditions and confidence
with justification, always citing the engine inputs it used.
_Avoid_: recommendation, report, insight, opinion

**Journal**:
The chronological record of a user's decisions and analyses, each later scored against realized
outcomes.
_Avoid_: history, log, diary

**Horizon**:
The date at which a decision is scored: the date stated in its thesis or, by default, the
expiry of its operation.
_Avoid_: deadline, due date, target date

**Score**:
The evaluation of a decision or analysis at its horizon: realized P&L normalized by max loss,
whether the thesis held (crossed with the stated confidence, Brier-style), and, for "do not
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

**Invite**:
An email address the owner has cleared to register while `REGISTRATION_MODE=invite`; consumed
the moment that email completes sign-up. Not scoped to a user: it has none until consumed.
_Avoid_: invitation code, whitelist entry

**Terms acceptance**:
The record that a user accepted the terms of use and privacy policy at registration, with the
version accepted and the timestamp. Append-only: a later terms version adds a new row, never
overwrites one.
_Avoid_: consent, agreement

**Magic link**:
A one-time, time-limited link that signs an existing, already-registered user in without a
password. Sign-in only: clicking it never creates a new account, so it cannot be used to bypass
terms/privacy acceptance or `REGISTRATION_MODE` (ADR-0018). pt-BR: "link mágico".
_Avoid_: passwordless login, one-time login link

**Password reset**:
The flow that lets a user set a new password after proving control of their email through a
one-time link, revoking every session that predates the reset (ADR-0018).
_Avoid_: forgot password, password recovery
