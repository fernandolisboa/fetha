---
status: accepted
date: 2026-10-13
---

# The radar reads every liquid optionable underlying against the recipes, nightly (#308, amends 0042, 0045)

## Context

The watchlist only shows what the user already chose to follow, and nothing looks beyond it
(#303). The owner, a layman in options, wants the app to point at assets worth adding and say
why. The recipes (ADR-0064) are complete strategy definitions the engine already evaluates, and
the asset reading (ADR-0059) labels one ticker from engine facts. Running every user's own
strategies across the whole market would cross tenants; recipes are shared, so a recipe's match
on an underlying is the same fact for every user.

## Decision

1. **Universe.** Every underlying with an IV index point (ADR-0054) on the scanned session whose
   options traded (any series with `trades > 0`) on at least **17 of the last 21 sessions**
   ending at it, about four sessions in five over a trading month. The threshold is this
   project's default, `RADAR_LIQUIDITY` in `modules/radar/scan.ts`; nothing in the references
   gives a liquidity bar for B3 single names. The IV point requirement already implies a candle
   and a chain on that session.
2. **Nightly, shared, reference data.** After ingestion (and so after the IV index step),
   evaluation and scoring, the nightly job runs `scanRadar` on the newest ingested session, under
   the same deadline as the steps before it. Two tables in the new `radar` module, both without
   `user_id`, written only by that step and read by every user, the IV index's class. Outside
   production the E2E seed route also files one fixture row (the `decisions` E2E seed
   precedent); on a preview where the nightly has not seeded that session yet, the fixture is
   the session's whole universe, which is acceptable for test data:
   - `radar_readings` (`underlying`, `session`, `as_of`, `reading`, `computed_at`): one row per
     universe underlying and session; `reading` is the engine's `AssetReading` at the session's
     close, null while the underlying is pending.
   - `radar_matches` (`underlying`, `session`, `recipe_id`, `facts`, `legs`): one row per recipe
     that found an entry, deleted with its reading. `facts` holds the close and every indicator
     of the recipe's entry condition; `legs` the series one unit of the structure resolves to.
     Both are validated by Zod on write and on read.
     User strategies keep running only over each user's own watchlist (`evaluateSignalsForSession`).
3. **What a match is.** For each recipe, `evaluateStrategy` runs on the underlying at the
   session's close with no `since` (the latest candle only) and no risk profile. The entry
   condition held when the record's outcome is one ADR-0014 (Q45) records only after it held:
   `signal`, `unsizeable`, `no_series_match` or `degenerate_strikes`; with no capital the usual
   one is `unsizeable` (`no_declared_capital`). The radar then prices one structure unit through
   `priceOperation` with the recipe's strike and expiry selection; the match stands only when
   that resolves to listed series. The radar never sizes a position: sizing is the user's, when
   they copy the recipe.
4. **Facts.** The close and the entry indicators' values come from `engine.indicators` over the
   same view, read at the latest candle. A recursive indicator there (RSI, EMA, ATR) is seeded
   from the start of the loaded series rather than over its fixed trailing window (ADR-0048), so
   its value can differ from the one the evaluation read in the last decimals; the decision is
   always `evaluateStrategy`'s.
5. **No look-ahead.** Everything is read at the scanned session's close: the view
   (`buildRadarView`, the asset reading's view plus the CDI visible at that instant and the
   calendar through the chain's furthest expiry) holds nothing published after it.
6. **Budget, resumable per underlying.** The first run on a session seeds its universe as pending
   rows, then reads them one at a time until the nightly deadline; a later run (the cron runs
   three times a night, or the owner's manual trigger) reads the rest. The universe is seeded
   only once tonight's IV index session has a succeeded run, since seeding it earlier would
   freeze a partial universe. An underlying whose read fails stays pending and is counted as an
   error.
7. **Screen.** A "Radar" tab on the watchlist page (`/?aba=radar`); the rail keeps its six
   destinations (DESIGN.md). It shows the newest scanned session, how many universe underlyings
   were read and how many are pending, and one row per underlying where a recipe found an entry:
   its reading chips, each recipe as "a receita X encontrou entrada" with the facts that matched
   and the legs, how many option series traded at the close, "Adicionar à watchlist" (or "Na sua
   watchlist") and a link to the asset page's recipes. Rows are ordered by traded series, never
   by an invented attractiveness score. The copy frames a row as a recipe's finding; the direct
   voice the owner chose (#303) belongs to suggestions (#311).
8. **Report.** The nightly report (ADR-0045) gains `radar`: `status` (`ok`, `pending`,
   `failed`), `universe`, `readThisRun` (this run only; `universe - pending` is what the session
   holds read so far, which the owner's panel shows), `pending`, `matches` and an `errorCount`, or
   null when cotahist did not succeed.

## Consequences

- Adding a recipe to the book adds it to the radar with no code change.
- The radar shows the newest session with at least one underlying read; a session seeded but not
  read yet, or whose universe is empty (not enough liquidity history yet), leaves the previous one
  on screen, dated. "No recipe found an entry" is said only once nothing is pending.
- Rows accumulate one per universe underlying per session (tens a night); no retention yet.
- A recipe removed from the book drops out of the screen even for sessions scanned with it.
- `@fetha/contracts` exports `conditionIndicators`, already used to bound strategy writes, so the
  radar lists a recipe's entry indicators without walking the condition tree itself.

## Considered options

- Run each user's active strategies over the whole universe: crosses tenants and multiplies the
  nightly work by the number of users, for rules nobody shared.
- A reference risk profile so the engine sizes and returns a full signal with its indicator
  readings: the proposal's quantity would come from invented capital.
- An attractiveness score to order rows: no engine fact supports one, and the AI never produces
  numbers (principle 1).
- One more table for each night's scan: the pending readings already record the universe.

## Amendment (2026-10-13, ADR-0067)

Item 3 now prices one B3 standard lot (100 units per ratio unit of the structure), not one unit,
and a match the engine fully priced with a bounded max loss and one shared expiry is also stored
as a suggestion (`suggestions`, scored at its horizon). Item 7's deferral of the direct voice to
#311 is fulfilled: the home shows "Sugestões de hoje" in Fetha's own voice; the radar tab keeps
the recipe's voice. See docs/adr/0067.

## Amendment (2026-10-26, ADR-0074)

The radar's tables are no longer all shared reference data: `suggestion_sightings` records, per
user, when a suggestion first showed on their screen, for the per-user archive of seen
suggestions. It is user-scoped, with an isolation test, in the account export and deleted with
the account.
