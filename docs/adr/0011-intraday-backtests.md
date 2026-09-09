---
status: accepted
date: 2026-09-08
---

# Intraday strategies: candles persisted per user, option fills at model fair value

Intraday strategies (`15m`, `30m`, `60m`) are backtestable in v1 with two declared limits.
First, intraday history is short: the provider's depth is undocumented and options have no
intraday history at all, so Fetha persists every intraday candle it fetches (in the space of the
user whose token fetched it) so the window grows over time, and a run over a short window shows
the window and refuses to annualize its metrics. Second, option fills in an intraday run use the
engine's fair value (ADR-0002) with that day's closing implied volatility from COTAHIST plus
slippage, because no intraday option price history exists; the run report states this
approximation. Live intraday signals use the real chain. This amends ADR-0004, which stays in
force for daily runs.

## Considered options

- Intraday strategies limited to stocks and ETFs: honest but excludes the structures Fetha is
  for; the declared approximation is preferable to a silent gap.
- Buying intraday option history: no accessible source offers it for B3.
