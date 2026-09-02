# Fetha — Context

_Stub. Filled in Phase 1 by `/grill-with-docs`._

Fetha is a personal trading and investment lab for the Brazilian market (B3). It ingests market
data, computes indicators, options prices and backtests deterministically in `packages/engine`,
and lets an AI layer reason over those computed artifacts to help a user decide. Every decision
is the user's own; the app keeps a scored decision journal.

Modules: `auth`, `market-data`, `engine`, `strategies`, `portfolio`, `decisions`.

Invariants: AI never produces numbers; strategies are data; backtest hygiene is enforced by the
engine; tenant isolation per user account; LGPD by design.
