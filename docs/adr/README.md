# Architecture Decision Records

One file per decision: `NNNN-title.md` with a short statement of context, decision and why, plus
optional considered options and consequences. Accepted ADRs are never edited; a later ADR
supersedes or amends them and says so.

| ADR  | decision                                                                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 | Numeric representation: decimal prices, integer centavos                                                                                                                    |
| 0002 | Option pricing: Black-Scholes-Merton, European for all series                                                                                                               |
| 0003 | No broker integration, no order execution                                                                                                                                   |
| 0004 | Backtest hygiene enforced by the engine                                                                                                                                     |
| 0005 | Decision and analysis scoring                                                                                                                                               |
| 0006 | Engine as a pure package with a frozen public interface                                                                                                                     |
| 0007 | Data providers: public B3 and Bacen backbone, per-user intraday tier                                                                                                        |
| 0008 | Strategy DSL: declarative JSON with a closed vocabulary                                                                                                                     |
| 0009 | AI decision contract: on demand, per object, engine artifacts only                                                                                                          |
| 0010 | Intraday data and strategies refresh only while the app is in use                                                                                                           |
| 0011 | Intraday backtests: persisted candles, option fills at model fair value (amends 0004)                                                                                       |
| 0012 | Strategy sharing by visibility                                                                                                                                              |
| 0013 | Engine public interface: ten methods over one market view, frozen                                                                                                           |
| 0014 | Evaluation, backtest and scoring rules (amends 0004, 0005, 0008)                                                                                                            |
| 0015 | Themes are per-user token sets; component anatomy is never themed                                                                                                           |
| 0016 | Better Auth for identity; the user account is the tenant                                                                                                                    |
| 0017 | Reference data ingestion: sources, partitioning, retries, freshness, adjustment (amends 0004, 0007)                                                                         |
| 0018 | Magic link, password reset and database-backed rate limiting (amends 0016)                                                                                                  |
| 0019 | Vertical slices inside the single Next.js app: a module owns its tables                                                                                                     |
| 0020 | Registration mode changes without a redeploy: Vercel Global Config, as in Feudo (amends 0016)                                                                               |
| 0021 | Real portfolio: fills are the only stored fact; positions, cash and operation legs are derived (qualifies 0006)                                                             |
| 0022 | Decisions on held operations are scored on the position held and the portfolio's own fills (amends 0014)                                                                    |
| 0023 | Strategy comparison and walk-forward read persisted runs; windows chosen at creation (sharpens 0013)                                                                        |
| 0024 | Account rate-limit buckets are keyed by an email hash and purged after 60 seconds (amends 0018)                                                                             |
| 0025 | The PWA caches build output only; pages and API responses never reach Cache Storage                                                                                         |
| 0026 | HTTP security headers on every response; a script-src CSP waits for nonces                                                                                                  |
| 0027 | LGPD: an access log written by read models, a per-module data export, deletion through Better Auth                                                                          |
| 0028 | Email-first registration: the password is chosen after the verification link; unverified accounts purged at 24 h                                                            |
| 0029 | Invites are spent by mailbox proof (verification link, magic link or reset), not by sign-up                                                                                 |
| 0030 | Magic-link and password-reset tokens stored hashed in `verification` (amends 0018)                                                                                          |
| 0031 | Mail sent after the response; the sign-in account bucket counts failures only (amends 0016, 0018)                                                                           |
| 0032 | Per-user caps on backtest runs in progress and on strategy versions (builds on 0018, 0020)                                                                                  |
| 0033 | Expired sessions purged nightly; session lifetime pinned at 7 days (amends 0027)                                                                                            |
| 0034 | The change-password and verify-password endpoints answer 404; password reset sets a new password (amends 0027)                                                              |
| 0035 | Documents enforce a nonce script-src from the proxy; the report-only step is skipped (amends 0026)                                                                          |
| 0036 | A signed-in gate asks existing users to re-accept a new terms version (amends 0016, 0028)                                                                                   |
| 0037 | Discarding a stuck backtest run, and listing runs in progress across strategies (amends 0032)                                                                               |
| 0038 | `fixed_fractional` sizes a net-debit structure on max(premium, bounded max loss) (amends 0013)                                                                              |
| 0039 | A typed web-authored evaluation vocabulary; `EvaluationRecord.detail` removed (amends 0013)                                                                                 |
| 0040 | B3 fees charged by instrument class: an option-premium rate beside the cash-equity rate (amends 0004, 0013)                                                                 |
| 0041 | Backtest metrics are computed over observed sessions only; the warm-up prefix is excluded (amends 0013)                                                                     |
| 0042 | The manual ingestion trigger is gated by the owner's session, not `CRON_SECRET` (#51)                                                                                       |
| 0043 | Strategies are archived, never deleted; archived ones leave the cap and sharing (amends 0012, 0032)                                                                         |
| 0044 | Entry proposals older than five sessions stay out of the inbox; the catch-up still logs them (amends 0039)                                                                  |
| 0045 | `nightly_runs`: a redacted run report recorded by every nightly run, read by a Postgres role (#220)                                                                         |
| 0046 | The guided tour is hand-built on the Popover; its dismissal is a per-user preference (#231)                                                                                 |
| 0047 | Re-evaluating a session is append-only, per user and strategy, and audited (#84, amends 0027)                                                                               |
| 0048 | Recursive indicators are read over a fixed trailing window at each evaluated candle (#239, amends 0013)                                                                     |
| 0049 | Indicator parameters are bounded where a definition is written, not where one is read (#249)                                                                                |
| 0050 | An SMA is read only when its whole window of sessions holds a candle (#250, amends 0048)                                                                                    |
| 0051 | An IV rank is read only when its whole window of sessions holds an IV point (#254, amends 0050)                                                                             |
| 0052 | Corporate-action factors are owner-entered on /configuracoes, no automatic source yet (#50, amends 0013)                                                                    |
| 0053 | The structure catalog is one file, each entry with its source and default selection (#20)                                                                                   |
| 0054 | The IV index is computed nightly from already-ingested option prices, no new source (#81, amends 0017, 0051)                                                                |
| 0055 | A daily candle is its session, read at its latest visible version (#38, amends 0013)                                                                                        |
| 0056 | Option series keep their ticker across a corporate action; strikes are point-in-time (#69, amends 0014, 0017)                                                               |
| 0057 | AI analyses: engine facts in, a checked contract out, a reserved monthly cap (#28, sharpens 0009, amends 0005 and 0006)                                                     |
| 0058 | AI analyses carry an outlook, scored by the engine at its horizon (#292, amends 0057, restores 0005)                                                                        |
| 0059 | The asset reading: engine labels from project-default thresholds (#304, amends 0013)                                                                                        |
| 0060 | Company filings come from CVM open data, mapped to tickers by CNPJ (#309, amends 0007, 0017, 0045, 0054)                                                                    |
| 0061 | Exchange rates are read-only PTAX reference series (#305, amends 0007, 0017)                                                                                                |
| 0062 | The Ibovespa level is a close-only candle under IBOV11, read nightly from B3's index service, with cash settlement wired into the portfolio (#307, amends 0007, 0017, 0054) |
| 0063 | Index options carry a price factor; premiums are reais per contract, strikes and spot stay in points (#307, amends 0013; notes 0040)                                        |
| 0064 | Recipes are shared, read-only strategy definitions chosen by expected move (#306, amends 0053)                                                                              |
| 0065 | Sentiment: filing labels, GDELT tone, a news-provider seam (#310, sharpens 0009, amends 0007, 0016, 0017, 0045, 0060)                                                       |
| 0066 | The radar reads every liquid optionable underlying against the recipes, nightly (#308, amends 0042, 0045)                                                                   |
| 0067 | Suggestions are priced radar matches, spoken in direct voice and scored like decisions (#311, amends 0014, 0057, 0058, 0066)                                                |
| 0069 | Two layouts, Workspace and Studio, and four themes carried over from Bardo and Mascate (amends 0015)                                                                        |
| 0070 | B3 options are dividend-protected, so the engine prices them with `q = 0`; no dividend source (#81, amends 0013, 0054)                                                      |
