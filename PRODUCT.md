# Fetha — Product

A personal trading and investment lab for the Brazilian market (B3), delivered as an installable
PWA. Multi-user by design: each user analyzes their own capital with their own inputs. Single
user in practice today; family or friends may get access later.

## Who it is for

An individual investor who wants to study, price and backtest options structures and directional
strategies before putting money at risk, and who wants an honest record of how well their own
decisions age. No fees, no plans, no order execution. Every decision is the user's own.

## The six jobs

### 1. Market data

Daily candles, option series and prices, macro series (CDI/Selic/IPCA) and the trading calendar
from public B3 and Bacen sources, ingested nightly as shared reference data. An optional intraday
tier per user (live quotes, chain, 15/30/60-minute candles) fetched with the user's own provider
token, refreshed only while the app is in use.

### 2. Engine

Indicators, options pricing and greeks, payoff of multi-leg structures (travas, collars, covered
calls, butterflies, condors...), an event-driven backtester with no look-ahead by construction,
and portfolio and risk metrics. Deterministic and exact: decimal prices, integer centavos.

### 3. Strategy catalog, watchlist and signals

Declarative strategy definitions (data, not code) that can be backtested, versioned, diffed and
compared. Definitions come from standard references (Hull, B3 materials). Active strategies run
over the user's watchlist: daily ones at the close, intraday ones while the app is open; signals
land in an inbox and wait for the user's decision, including "do not enter". A user may share a
strategy read-only with every registered user, who copies it to use it.

### 4. Charts

Candles with overlays, payoff diagrams, equity curves, drawdown, distribution of returns. Charts
are the primary reading surface; numbers and charts share one visual language.

### 5. AI decision layer

On demand, one object at a time (a signal, an operation, a strategy with its backtest), reasoning
over engine outputs only: thesis, counter-thesis, key risks, max loss, break-evens, invalidation
conditions, confidence with justification. Every analysis and every recorded decision goes to a
journal that is scored at its horizon (outcome, thesis accuracy, counterfactual for "do not
enter"), so the user sees their own track record and the AI's calibration.

### 6. Real portfolio

Fills entered by hand or imported from the spreadsheet B3's investor area exports, grouped into
operations, marked to market, with exercise and expiry outcomes proposed on expiry dates. No
broker connection, no order execution.

## Core screens

1. Onboarding: registration, verification, login, terms and privacy acceptance.
2. Workstation shell: dense, data-first, dark; navigation across watchlist, signals, strategies,
   portfolio, journal and settings.
3. Structure and payoff screen: build a structure leg by leg on a live or closing chain, see
   payoff, fair value, greeks, break-evens and max loss against the risk profile, request an
   analysis, record a decision.
4. Candle chart with indicator overlays, daily and intraday timeframes, adjusted or nominal
   series.
5. Signal inbox: today's and late signals, each answered by a decision.
6. Strategy editor and backtest report: equity curve, drawdown, distribution, walk-forward view,
   declared limits of intraday runs.
7. Portfolio and risk dashboard: positions, operations, mark to market, limits.
8. Decision journal with scores and calibration.
9. Settings: declared capital and risk profile, provider token, sharing, data export, account
   deletion.

Later: strategy comparison, fills import from brokerage notes, audit log view.

## Principles that shape the product

- AI never produces numbers. Every number on screen comes from the engine.
- Strategies are data. Backtest hygiene is enforced by the engine, not by discipline.
- Tenant isolation is absolute. Reference data, the catalog and strategies a user chose to share
  are the only shared data, read-only to users.
- Privacy by design (LGPD): terms at registration, minimal storage, export and deletion, audit
  log.
- Exact numbers: decimal prices, integer centavos, Brazilian formatting.
- Dense and honest. No gamification, no upsell, no fintech-landing-page energy.

## Platform reality

Desktop-first; nearly all access from a Windows PC (Edge/Chrome) as an installed PWA. Offline:
cached shell only.

## Out of scope for v1

Fees, plans, billing, order execution, broker connections and Open Finance sync, shared
workspaces, 1- and 5-minute timeframes, native builds.
