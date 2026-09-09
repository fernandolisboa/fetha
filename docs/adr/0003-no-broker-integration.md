---
status: accepted
date: 2026-09-02
---

# No broker integration: fills are entered by hand or imported from the B3 export; no order execution

Fetha never connects to a broker, never reads positions from Open Finance and never sends
orders. Fills come from manual entry or from the spreadsheet B3's investor area exports
(broker-agnostic, includes options); brokerage-note parsing may follow, one broker at a time.
Reasons: Open Finance excludes options and derivatives, the aggregator route (Pluggy) costs on
the order of R$ 2.500/month for a single household, and order execution would require a local
bridge (MetaTrader 5, Profit DLL or a broker API) plus a security posture the product does not
need to be useful. The owner decided this explicitly on 2026-09-02; reopen only with a new ADR.

## Considered options

- Open Finance via Pluggy: covers stocks and ETFs with a one-day lag, not options; price
  disproportionate to a personal tool.
- Order execution through a broker API or platform bridge: technically possible (BTG REST API,
  MT5 at XP/Rico/Genial/Modal), but the app would become an execution surface with real money at
  stake, which contradicts "decision support only".
