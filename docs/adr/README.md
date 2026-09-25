# Architecture Decision Records

One file per decision: `NNNN-title.md` with a short statement of context, decision and why, plus
optional considered options and consequences. Accepted ADRs are never edited; a later ADR
supersedes or amends them and says so.

| ADR  | decision                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 0001 | Numeric representation: decimal prices, integer centavos                                                        |
| 0002 | Option pricing: Black-Scholes-Merton, European for all series                                                   |
| 0003 | No broker integration, no order execution                                                                       |
| 0004 | Backtest hygiene enforced by the engine                                                                         |
| 0005 | Decision and analysis scoring                                                                                   |
| 0006 | Engine as a pure package with a frozen public interface                                                         |
| 0007 | Data providers: public B3 and Bacen backbone, per-user intraday tier                                            |
| 0008 | Strategy DSL: declarative JSON with a closed vocabulary                                                         |
| 0009 | AI decision contract: on demand, per object, engine artifacts only                                              |
| 0010 | Intraday data and strategies refresh only while the app is in use                                               |
| 0011 | Intraday backtests: persisted candles, option fills at model fair value (amends 0004)                           |
| 0012 | Strategy sharing by visibility                                                                                  |
| 0013 | Engine public interface: ten methods over one market view, frozen                                               |
| 0014 | Evaluation, backtest and scoring rules (amends 0004, 0005, 0008)                                                |
| 0015 | Themes are per-user token sets; component anatomy is never themed                                               |
| 0016 | Better Auth for identity; the user account is the tenant                                                        |
| 0017 | Reference data ingestion: sources, partitioning, retries, freshness, adjustment (amends 0004, 0007)             |
| 0018 | Magic link, password reset and database-backed rate limiting (amends 0016)                                      |
| 0019 | Vertical slices inside the single Next.js app: a module owns its tables                                         |
| 0020 | Registration mode changes without a redeploy: Vercel Global Config, as in Feudo (amends 0016)                   |
| 0021 | Real portfolio: fills are the only stored fact; positions, cash and operation legs are derived (qualifies 0006) |

Open: none.
