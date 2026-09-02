# Fetha — Product

A personal trading and investment lab for the Brazilian market (B3), delivered as an installable
PWA. Multi-user by design: each user analyzes their own capital with their own inputs. Single
user in practice today; family or friends may get access later.

## Who it is for

An individual investor who wants to study, price and backtest options structures and directional
strategies before putting money at risk, and who wants an honest record of how well their own
decisions age. No fees, no plans, no order execution. Every decision is the user's own.

## The five jobs

### 1. Market data

Quotes, fundamentals, historical candles, options chains and macro series (CDI/Selic/IPCA), from
licensed or public sources only, ingested daily and kept as shared reference data.

### 2. Engine

Indicators, options pricing and greeks, payoff of multi-leg structures (travas, collars, covered
calls, butterflies, condors...), an event-driven backtester with no look-ahead by construction,
and portfolio and risk metrics. Deterministic and exact: decimal prices, integer centavos.

### 3. Strategy catalog

Declarative strategy definitions (data, not code) that can be backtested, versioned, diffed and
compared. Definitions come from standard references (Hull, B3 materials).

### 4. Charts

Candles with overlays, payoff diagrams, equity curves, drawdown, distribution of returns. Charts
are the primary reading surface; numbers and charts share one visual language.

### 5. AI decision layer

Reasons over engine outputs only: thesis, counter-thesis, key risks, max loss, break-evens,
invalidation conditions, confidence with justification. Every analysis and every recorded
decision goes to a journal that is scored against realized outcomes, so the user sees their own
track record.

## Core screens

1. Onboarding: registration, verification, login, terms and privacy acceptance.
2. Workstation shell: dense, data-first, dark; navigation across tickers, strategies, portfolio
   and journal.
3. Strategy and payoff screen: build a structure leg by leg, see payoff, greeks, break-evens and
   max loss, run a backtest, read the AI thesis and counter-thesis.
4. Candle chart with indicator overlays.
5. Backtest report: equity curve, drawdown, distribution, walk-forward view.
6. Portfolio and risk dashboard.
7. Decision journal with scoring.

Later: strategy comparison, settings (data export, account deletion), audit log.

## Principles that shape the product

- AI never produces numbers. Every number on screen comes from the engine.
- Strategies are data. Backtest hygiene is enforced by the engine, not by discipline.
- Tenant isolation is absolute. Market data and the strategy catalog are the only shared data,
  read-only to users.
- Privacy by design (LGPD): terms at registration, minimal storage, export and deletion, audit
  log.
- Exact numbers: decimal prices, integer centavos, Brazilian formatting.
- Dense and honest. No gamification, no upsell, no fintech-landing-page energy.

## Platform reality

Desktop-first; nearly all access from a Windows PC (Edge/Chrome) as an installed PWA. Offline:
cached shell only.

## Out of scope for v1

Fees, plans, billing, order execution, shared workspaces, native builds.
