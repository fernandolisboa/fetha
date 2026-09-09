# Architecture Decision Records

One file per decision: `NNNN-title.md` with a short statement of context, decision and why, plus
optional considered options and consequences. Accepted ADRs are never edited; a later ADR
supersedes or amends them and says so.

| ADR  | decision                                                                              |
| ---- | ------------------------------------------------------------------------------------- |
| 0001 | Numeric representation: decimal prices, integer centavos                              |
| 0002 | Option pricing: Black-Scholes-Merton, European for all series                         |
| 0003 | No broker integration, no order execution                                             |
| 0004 | Backtest hygiene enforced by the engine                                               |
| 0005 | Decision and analysis scoring                                                         |
| 0006 | Engine as a pure package with a frozen public interface                               |
| 0007 | Data providers: public B3 and Bacen backbone, per-user intraday tier                  |
| 0008 | Strategy DSL: declarative JSON with a closed vocabulary                               |
| 0009 | AI decision contract: on demand, per object, engine artifacts only                    |
| 0010 | Intraday data and strategies refresh only while the app is in use                     |
| 0011 | Intraday backtests: persisted candles, option fills at model fair value (amends 0004) |
| 0012 | Strategy sharing by visibility                                                        |

Open: the engine public interface itself (Phase 2, designed twice and frozen).
