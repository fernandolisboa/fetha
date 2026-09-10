---
status: accepted
date: 2026-09-02
---

# Backtest hygiene is enforced by the engine

A backtest run is deterministic and immutable: the same strategy version, universe, period,
capital, cost model and sizing rule over the same data always produce the same operations,
equity curve and metrics, and that is a test. The engine makes look-ahead impossible by
construction: a signal computed at the close of session D can only be filled in session D+1, and
the strategy evaluator receives a data view truncated at D. Fills: stocks at the next session's
open; options at the next session's average traded price (COTAHIST `PREMED`) plus configurable
slippage; a series with no trades that day produces no fill and the missed entry is recorded.
Costs are always charged: B3 fees, brokerage per order (defaults: zero for stocks, per-contract
for options) and a simplified income tax (15% on monthly net gains; the R$ 20.000 monthly sales
exemption applies to stocks only, never to options; no loss carry-forward yet). Risk-profile
limits are enforced by default and a run may be configured to only warn. Every dataset used by
backtests documents its survivorship-bias properties (COTAHIST includes delisted instruments and
is not adjusted for corporate actions; adjustments are applied and versioned by the ingestion
layer). Recording real corporate-action factors from labeled events is tracked in #50: the
`corporate_action_factors` table exists and the engine reads it (ADR-0013), but no source
ingestion #12 (ADR-0017) added currently writes to it.

## Considered options

- Fill options at the COTAHIST close: unreliable in illiquid series, systematically optimistic.
- Same-day fills at the close that generated the signal: the classic look-ahead leak; rejected.
- Leaving costs and limits optional: an "ideal" backtest is a marketing number, not a decision
  input.
