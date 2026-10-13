---
status: accepted
date: 2026-10-13
---

# Recipes are shared, read-only strategy definitions chosen by expected move (#306, amends 0053)

## Context

A user who adds an instrument to the watchlist gets nothing until they write a strategy,
backtest it and turn it on (#303). The owner, a layman in options, does not know which strategy
to write. The catalog (ADR-0053) gives a structure with a default strike and expiry selection,
and deliberately stops there: "full reference strategies (entry and exit rules) in the catalog"
were rejected because the sources define payoffs, not signals. #306 asks for exactly those full
strategies, picked by what the user expects the instrument to do, ready in one click, and
reusable later by the radar (#308) and suggestions (#311) as the rules they match against.

## Decision

1. **One file next to the catalog.** `apps/web/src/modules/strategies/recipes.json` lists every
   recipe: an id, the **expected move** it serves (`up`, `down`, `sideways`, `big_move`), the
   **IV regime** it enters on (`low`, `high`, `any`), a complete `StrategyDefinition`, its
   `reference` and its `notes`. `recipeBookSchema` in `packages/contracts` validates it; the
   definition parses through `strategyDefinitionInputSchema`, so a recipe obeys the same write
   bounds a hand-written strategy does. A unit test checks that every definition is coherent with
   its catalog structure, keeps that entry's default strikes and expiry, and reads IV rank the way
   its regime says. The file is shared and read-only like the catalog; nothing is stored in the
   database until a user copies a recipe.
2. **Recipes are data the engine already runs.** A recipe's definition is an ordinary strategy
   definition, so the engine evaluates and backtests it without a new interface. The radar and
   suggestions read `recipes` from the `strategies` entry point and evaluate the definitions
   themselves; they need no copy in the user's space.
3. **The mapping, sourced.** Expected move to structure follows Hull, _Options, Futures, and
   Other Derivatives_, ch. 12 (spreads, combinations, an option with its underlying) and B3 Edu
   "Opções"; IV regime follows the sign of each structure's vega (Hull, ch. 19, "Vega"): a
   structure that buys premium enters when IV is low, one that sells it when IV is high.

   | expected move | IV low                       | IV high                       | any IV         |
   | ------------- | ---------------------------- | ----------------------------- | -------------- |
   | up            | bull call spread, long call  | bull put spread, covered call |                |
   | down          | bear put spread, long put    | bear call spread              |                |
   | sideways      |                              |                               | call butterfly |
   | big move      | long straddle, long strangle |                               |                |

   The issue placed the butterfly under IV low. A long butterfly is short vega at its body, so
   the vega rule would put it under IV high instead, and neither source ties it to an IV level;
   it enters on any IV. No bounded structure in the catalog serves a sideways or big-move view
   when IV is high (the short straddle and strangle cannot be sized, ADR-0053).

4. **Thresholds are this project's defaults, not the sources'.** Every recipe is `D1` and:
   - **Trend filter** confirms the expected move: up enters on a close above its 50-session SMA
     with a 14-session RSI below 70; down on a close below that SMA with RSI above 30; sideways on
     RSI between 40 and 60; a big move has no direction, so no trend filter.
   - **IV filter**: the DSL's `iv_rank` over 63 sessions below 50 for `low`, at or above 50 for
     `high`. The engine's `iv_rank` is a percentile (the share of the window's points below
     today's IV), not the min–max IV rank some platforms quote, so "below 50" means "below its
     own median over the quarter"; one spike in the window moves the two measures apart.
     The usual convention is a year (252 sessions); Fetha computes its IV index only from the
     sessions it has ingested (ADR-0054), so a year-long window would leave every IV-filtered
     recipe unable to enter for a year. A quarter starts reading three months after the first IV
     point. Revisit once a year of IV history exists.
   - **Exits**: debit structures take profit at 1× the premium paid for single options and the
     butterfly, 0.5× for debit spreads and the straddle and strangle; credit spreads at 0.5× the
     premium received; every recipe stops at 0.5× its max loss except the covered call, which
     stops at 0.1× (its max loss is the stock's whole price) and has no profit target (its
     premium base is the stock's cost). Every recipe closes 5 business days before expiry, 10
     for single options, the straddle and the strangle, whose time decay speeds up near expiry.
   - **Sizing** is always `fixed_risk`, so the answer to "how much do you accept to lose per
     operation" (1%, 2% or 5% of the declared capital, default 2%) replaces its fraction. The
     picker shows that budget in reais as an approximation, not a cap: costs come on top, and
     the backtest sizes on its current equity while nightly signals size on the declared
     capital, so the budget drifts with the equity curve. The covered call's max loss is the
     stock's whole price, so on a small capital it buys few shares and costs weigh heavily; its
     copy says so.
5. **One click, end to end.** On the asset page, "Usar uma receita" asks the expected move and
   the risk, lists the matching recipes with a payoff sketch, and `startRecipeAction` (the new
   `recipes` module) then, for the signed-in user: refuses without a declared capital (nothing is
   created), adds the instrument to the watchlist (a backtest universe must be on it), copies the
   recipe as a new private, inactive strategy named "<structure> em <ticker>" through
   `createStrategyAction` (its rate limit and coherence check apply), and starts a backtest run
   through `backtests`' `startBacktestRun` (the same checks as the create-run form) over the last
   two years, with the declared capital, the B3 default cost model, limits in warn mode and the
   default walk-forward window. It redirects to the report with `?executar=1`, which starts the
   first chunk on arrival. The report shows reading notes for a layman and a link back to the
   strategy, where the user turns it on. The user states the expected move; the recipe only maps
   it to a structure and never turns itself on.
6. **The payoff sketch is a picture, not a figure.** It is the legs' intrinsic value at expiry
   over ±20% of a reference spot, minus its own mean, drawn without axes or numbers. Every number
   the user reads comes from the engine: the backtest report, or the operation builder. Because
   no premium is known there, where the curve crosses zero is an artefact of the drawn range,
   not a break-even; the sketch's label calls it an illustration. Its math reads the
   `Structure` legs in `apps/web` on purpose instead of calling the engine, whose frozen API
   (ADR-0013) exposes payoffs only inside a priced operation; if the radar (#308) needs the same
   shape, a `payoffShape` belongs in the engine through an ADR-0013 addendum and this copy goes.

## Consequences

- Adding a recipe is a data change: an entry in `recipes.json`, its copy in the `recipes`
  module's strings (a test fails without it), and a scenario in the per-recipe backtest
  integration test if its expected move or IV regime is new.
- A recipe copied before a change to the file keeps the definition it was copied with: copies are
  ordinary strategies and versions.
- No migration: a copied strategy does not record which recipe it came from. #308 and #311 match
  the file, not the copies; add provenance only when a feature needs it.
- The flow is not one transaction. A refusal after the watchlist add keeps the instrument on the
  watchlist (the user picked it), and a backtest refused for its rate limit or the active-run
  cap leaves the copied strategy in place; the error links to it, so the user runs the test from
  there instead of copying the recipe again.
- The report's reading notes show on every backtest report, not only on recipe runs: they hold
  for any strategy, and the owner reads every report as a layman.
- `backtests` exposes `startBacktestRun`, the create-run logic the form's action now wraps, so a
  second entry point cannot drift from the first.

## Considered options

- Recipes as catalog entries (amending ADR-0053's file): mixes a structure's definition with a
  rule set on top of it, and one structure can carry several recipes.
- Rows in a table: a migration for read-only data only the app reads, the same reason ADR-0053
  kept the catalog in a file.
- Choosing the IV regime for the user from today's IV rank: the asset reading (#304) shows it,
  and the radar (#308) will match it; the picker shows every recipe for the expected move with
  the regime it suits, so the choice stays the user's.
