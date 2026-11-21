---
status: accepted
date: 2026-11-20
---

# An operation plan is a contemplated operation plus its own rules table

## Context

Ticket #379 ("Montar plano") asks Fetha to produce a complete, ready-to-execute operation plan
from a suggestion or from one question on an asset page ("O que você espera de TICKER nas
próximas semanas?": sobe / cai / fica de lado / não sei), for the user to review and save, never
to author. Every number in it — the structure, the series, the size, the limit prices, the exit
and roll dates — has to come from the engine (CLAUDE.md principle 1), never from the AI layer,
which only explains a plan already computed.

Fetha already has a contemplated operation (`contemplated_operations`, the builder's saved
snapshot of a priced structure: structure id, legs, session, net premium, max loss/gain,
`OperationsRepository`) and a decisions journal that records an "enter" decision against one
(`decisions`, `DecisionsRepository`, ADR-0021/0022). A plan is not a different kind of saved
position; it is a contemplated operation the user never typed in by hand, plus the rules Fetha
chose for exiting or rolling it. Inventing a parallel "plan" entity that duplicates structure,
legs and pricing would fork the model saved operations, held operations and the journal already
share.

## Decision

A saved plan is two rows: the existing `contemplated_operations` row (unchanged shape, saved
through the existing `OperationsRepository.save`) and a new `operation_plan_rules` row that
extends it with the plan's own half:

- `recipe_id`: which recipe of `apps/web/src/modules/strategies/recipes.json` the plan copied.
- `rules` (jsonb, `@fetha/contracts`'s `planRulesSchema`): the one-sentence reason, the recipe's
  exit rules each resolved to a session (or none, for a rule that fires against price rather than
  the calendar), and the roll rule (whether it applies, and at what session) for a structure that
  rolls (covered call, credit spreads). A plan never executes a roll; stating its rule and date is
  ticket #379's whole scope, executing it is #382 (the Carteira) and #383 (the backtester).

`operation_plan_rules` carries its own `user_id` and a composite foreign key on
`(contemplated_operation_id, user_id)` against `contemplated_operations`' matching composite
unique index (`contemplated_operations_id_user_id_idx`, added alongside `operations`' own
`operations_id_user_id_idx` the same way), the same pattern `fills` binds to `operations` — a row
can never be saved against, or read back through, another user's contemplated operation, which
`PlanRulesRepository`'s isolation test asserts directly. Migration `0049_operation_plans.sql` is
schema-only.

Saving a plan also records a `decisions` row of kind `enter`, origin `contemplated_operation`,
with the plan's own sentence as its rationale — the existing journal and scoring machinery
(ADR-0005, decision scores) picks it up without a new table, and "Fetha's original plan vs. the
user's edits" (ticket #379) is simply that decision's stored inputs compared against this row's
`rules` and the user's later recorded `held_operation` decisions on the same operation.

Generation itself (`apps/web/src/modules/plans/generate-plan.ts`) is a pure function: given a
recipe, an IV regime, a risk limit and a `pricingForLots` callback the caller backs with the
engine's own `priceOperation`, it sizes the structure in lots of 100 (ADR-0067's standard lot) to
the largest size whose max loss still fits the limit — reporting that the plan does not fit
rather than silently sizing to zero when even one lot is over it — prices every leg's limit from
its price and a tolerance, and resolves the exit and roll rules. The series itself (a monthly
expiry at least 20 sessions ahead, strikes by the recipe's own rule, never an untraded series) is
the engine's own `priceOperation` resolving a `LegSelection` (`structure`, `strikes`, `expiry`,
`quantity`), the same mechanism `radar`'s suggestions already use (`priceRecipeLot`); the plan
module only widens the `expiry` window it asks for (`legSelectionFor`,
`PLAN_MIN/MAX_SESSIONS_AHEAD`) rather than resolving a chain itself.

## Consequences

- No engine change, no `ENGINE_VERSION` bump: every number is an existing `priceOperation` call,
  composed by `apps/web`, not a new engine capability.
- A saved plan looks, in the Carteira, exactly like any other saved operation, since it is one;
  a future plan screen (#380/#381) will read its extra row to show the rules a plain saved
  operation has none of.
- Deleting a user cascades through `operation_plan_rules` the same two ways `fills` does: via its
  own `user_id` and via its contemplated operation's cascading delete.
- `recipe_id` is stored, not foreign-keyed: the recipe book is a static file, not a table (ADR-0064
  already treats it that way for `signals`/`suggestions`), so a recipe retired from the book still
  reads back from an old plan's row.

## Addendum (round 1 review): recipe fallback, limit-price sizing, the auto-recorded decision

The first pass of this ticket shipped with four defects a review caught before merge; this
addendum is the record of how each was actually resolved, since the body above already described
the _intended_ shape (a decision recorded alongside the plan) that the first pass did not yet
implement.

- **Recipe choice from a view** (`select-recipe.ts`): a stated view admits a set of the recipe
  book's own expected moves (`movesForView` in `view.ts`) — one each for sobe/cai/fica de lado,
  and both `sideways` and `big_move` for "não sei" (a direction-free view should not narrow to
  one move). Among the candidates for that set, the one whose own `ivRegime` matches today's
  exactly wins; none of the book's recipes today declare `ivRegime: "any"`, so on normal IV (or
  when the view's own regime has no entry at all, e.g. "fica de lado" only has high-IV recipes)
  the first remaining candidate is used instead — deterministic because the catalog order is
  fixed. No match at all (an empty candidate set) is `no_recipe`, distinct from `no_data` (a
  reading the engine could not produce at all).
- **Monthly expiry**: `monthly-expiry.ts` filters the market view's option chain to B3's monthly
  cycle — the third Friday of the month, walked back to the nearest trading session already in
  the view's own calendar when that Friday is a holiday — before the plan's `LegSelection` or its
  given-price call ever sees the chain. The calendar `buildOperationMarketView` already returns
  is extended through the chain's furthest listed expiry, so the walk-back always lands on a real
  session for any expiry actually in the chain; the walk is still capped (10 days) rather than
  trusted to terminate.
- **Untraded or stale legs**: `generate-plan.ts` reads one lot's _probe_ pricing (the engine's own
  last-price valuation) before ever sizing: any leg with `stale !== null` refuses the whole plan
  with `stale_prices`, any leg with `price === null` refuses with `no_market_price`. Neither is
  silently re-selected or priced at zero.
- **Sizing and the numbers reported come from a limit price, not the last price**: each candidate
  lot is priced twice (`priceLot` in `actions.ts`) — once at the market's own last price (the
  probe, also where the stale/untraded check above reads from), once more with every leg's price
  given explicitly at its own limit (the engine's `LegInput.price`, its "given" price source). The
  second call's `maxLoss`/`netPremium`/`breakEvens`/`limitBreaches` are the only numbers the plan
  ever reports, so a limit fill can never land outside what the user was shown. Lots are priced
  one at a time, stopping at the first one that breaches (`chooseLotSize` in `sizing.ts`), not 50
  calls up front.
- **The auto-recorded decision**: saving a plan writes `contemplated_operations`,
  `operation_plan_rules` and one `decisions` row of kind `enter` in a single transaction
  (`savePlanAction`). `OperationsRepository.save`, `PlanRulesRepository.save` and
  `DecisionsRepository.record` each take an optional `executor` (`Database | Transaction`,
  `@/db/client`'s new `Executor` type), defaulting to the repository's own `db`, so three
  different modules' repositories can share one `db.transaction` without any of them depending on
  another's internals.
  - **Horizon**: the plan's own exit date — the first resolved exit rule that names a session —
    falling back to the structure's shared option expiry (`deriveDefaultHorizon`'s own rule) when
    no exit rule has one. A structure with neither (a stock-only recipe with no dated exit rule;
    none exist in the book today) saves the plan without a decision rather than inventing a date.
  - **Claim**: derived from the recipe's own `expectedMove`, deterministically — `up`/`down` claim
    a close above/below the plan's own first break-even (round 2 review: the spot the view was
    taken at says nothing about whether this exact structure is still worth holding, while its
    break-even is the level it actually needs to clear; falls back to spot only when the plan has
    no break-even at all), `sideways`/`big_move` claim `operation_pnl_positive` (a one-sided price
    level claims nothing useful for either).
  - **Confidence**: the decision form (`DecisionBar`) starts with no value filled in, so there is
    no existing default to copy; the auto-recorded decision uses 0.5 (50%, the schema's neutral
    midpoint) and says so here rather than inventing a precise number.
  - **Scoring "Fetha's plan vs. the user's edits"** is still deferred, as the body above states,
    to the drag-to-adjust and "Executei" tickets (#380/#381); this decision's
    `contemplated_operation_id` already links it to the plan's own row, which is what that later
    scoring will join against.
- **Save-time mismatch**: `buildPlanAction`'s result carries a `fingerprint` (structure, lot count
  and legs — not price, which the limit tolerance already covers) that `savePlanAction` must be
  given back; a freshly rebuilt plan whose fingerprint differs is refused with `plan_changed`
  rather than silently saved as something the user never reviewed.
- **No risk profile declared**: `buildPlan` falls back to `DEFAULT_RISK_PROFILE` (ADR-0075), the
  same default every other risk-limit-aware feature uses, instead of refusing to build a plan at
  all.

## Addendum (round 2 review): pricing instant, IV regime, shared cache, fingerprint coverage

- **Pricing instant**: the first pass priced every leg at `nowInstant()` — the real wall-clock
  instant the request arrived at. During a trading day (from the open until the nightly ingestion)
  that instant's own session has no price yet, only the previous close does, so the engine's own
  staleness check (`LegValuation.stale`, ADR-0014 Q42: the price row's session is earlier than
  "the session of `at`") marked every leg stale and the plan always refused with `stale_prices`.
  Fixed by resolving the latest already-ingested session once (`latestSessionOnOrBefore`, the same
  anchor the radar scan and `resolveOutlookHorizon` price against) and pricing at that session's
  own close instant instead — the same `at` is then shared by `resolveFromView`'s IV reading,
  `buildPlan`'s pricing and open-operation count, and the saved operation's own `session`, so the
  plan is priced once, consistently, rather than against a moving "now". The plan's summary now
  also says which close its prices come from ("Preços do fechamento de 19/11/2026"), since that
  close is no longer necessarily "today's close read live".
- **IV regime computed once**: `resolveFromView` is now the only caller of `engine.assetReading`
  for a plan; it resolves both the regime used to pick a recipe (`ivRegimeFromReading`, "low" |
  "high" | "any") and the word the summary names today's volatility by (`ivDisplayFromLabel`,
  which keeps "normal" rather than resolving it away) from the same reading, and carries both on
  the resolved target. `buildPlan` no longer reads the asset a second time. A normal reading
  resolves to the regime nearer the reading's own IV rank (rank ≥ 50, the midpoint between the
  "low" and "high" thresholds, prefers the high-regime recipe; below it prefers low) rather than
  falling through to "any" and the catalog's first candidate, deterministic for the same reason
  the catalog-order fallback already was.
- **Shared pricing cache**: `buildPlan` builds one `Map<number, Promise<LotPricing | null>>`
  memoizing `priceLot` by lot count, used both for its own lot-1 precompute (reading the series
  facts and expiry) and as the `pricingForLots` callback `generatePlan` sizes against — the two
  call sites this ticket always had, now sharing one cache instead of each pricing lot 1 on its
  own.
- **Fingerprint covers price**: `planFingerprint` now also covers net premium and max loss
  centavos, not only structure, lot count and legs — a price move since the screen was built can
  leave all three of those the same while still moving the numbers the user was shown, and that
  move is exactly what `savePlanAction`'s "plan_changed" refusal exists to catch.
- **Monthly expiry walks backward off a holiday, evidenced**: `apps/web/e2e/fixtures/
b3-instruments/2026-09-18.csv` lists real PETR4 monthly series expiring 2026-11-19 and
  2028-04-20; the third Friday of each of those months (2026-11-20, 2028-04-21) is a B3 holiday
  (Consciência Negra, Tiradentes), confirming `isB3MonthlyExpiry`'s backward walk — not a forward
  one — matches the real calendar, pinned in `monthly-expiry.test.ts`.
- **Risk limit returned from the build**: `BuildPlanOutcome`'s ok variant now carries
  `riskLimitCentavos` (computed once inside `buildPlan`, where the risk profile is already
  resolved), so the plan page reads it from the build result instead of fetching the risk profile
  a second time of its own.

## Addendum (round 3 review): anchor to the newest ingested candle, not the newest closed session

The round 2 fix anchored pricing to `latestSessionOnOrBefore` — the newest session the calendar
already considers closed. That is still wrong for the owner's actual usage (mostly evenings,
BRT): between a session's close and the nightly ingestion finishing, or after a failed ingestion
run, the calendar already marks that session closed while no price for it has landed yet, so
pricing at it still marks every leg stale. `resolvePricingSessionFor` now anchors to the newest
session this underlying actually has an ingested daily candle for (`latestCandle`, then that
candle's own session resolved to a `TradingSession` via `tradingSessionForDate`) — the same
anchor `apps/web/src/modules/radar/e2e-seed.ts` already resolves a session by for exactly this
reason. Both the view and the suggestion paths resolve it, each against its own underlying
(`resolveFromView` from the parsed ticker, `resolveFromSuggestion` from the suggestion's own
underlying), and `buildPlan` reads it off the resolved target rather than resolving its own.

While there, `resolveFromView` and `buildPlan` had both called `buildOperationMarketView` for the
same underlying and instant; `resolveFromView` now carries the view it built on the resolved
target, and `buildPlan` reuses it (still filtering it to monthly expiries before pricing) instead
of asking for it twice. A suggestion-origin target never built one of its own, so `buildPlan`
still builds it fresh there, unchanged from round 2.

Finally, a real chain's liquidity is uneven even on a session with live data (the e2e fixtures'
own PETR4 chain only has some strikes actually trade a given close): `filterToTradedSeries`
(`traded-series.ts`) narrows the view's option chain a second time, beyond the monthly filter, to
tickers with at least one trade recorded (`OptionDayPrice.trades > 0`) at the anchor session
itself — before the engine's own moneyness rule ever runs, so a leg's selected strike can never be
one nothing traded at that close. `generate-plan.ts`'s `stale`/`price === null` refusal stays, but
now as a guard against something structurally unlikely rather than the only thing standing between
a thin chain and a bad plan.

## Addendum (round 4, ticket #380): drag-to-adjust stores both sides in `rules`, no new table

Ticket #380 lets the user move a plan's strikes, lots and expiry on its own payoff chart before
saving. `contemplated_operations.legs` already carries whatever the user last saw — Fetha's own
plan, unedited, when they touched nothing, or the edited legs when they did — since a plan is
still exactly one contemplated operation (the body above). Scoring "Fetha's plan vs. the user's
edits" (deferred from #379, still deferred past this ticket to whichever ticket actually computes
it) needs Fetha's own side kept somewhere once it is no longer the saved side, which is the one
new fact this ticket adds: `PlanRules.original` (`legs`, `lots`), an **optional** field — absent
for a plan saved before ticket #380 shipped, since those rows never wrote it and
`planRulesSchema.parse` must still read them back without throwing. Every plan `savePlanAction`
writes from here on populates it: with the exact same legs and lot count the save already wrote
to `contemplated_operations` when the user changed nothing, and with Fetha's
freshly-recomputed, never-trusted-from-the-client plan (`buildPlan`, the same auto-sizing path
#379 already had) when they did. When Fetha's own auto-sized plan did not even fit the risk limit
(`does_not_fit`) — so there is no real "Fetha's plan" to diff the user's edit against —
`original` falls back to echoing the edited side itself, rather than inventing one; a future
scoring pass reads this as "no divergence to score," not as a missing row. No migration: the
plan's own rules were already a jsonb column (`operation_plan_rules.rules`), and a new key on an
existing jsonb shape is schema-free the same way `signals`/`suggestions`' own jsonb payloads
already are (ADR-0064).

- **A new column or table for "Fetha's original legs".** `PlanRules` is already the one-to-one
  side table a plan's own half lives in (the body above); a second column there, or a second
  table, would duplicate the shape `contemplated_operations.legs` already has for the saved side.
  Rejected.
- **Only ever persist the edited plan, re-deriving "Fetha's plan" at scoring time by rebuilding
  it from the recipe again.** The market has moved on by the time scoring runs (ADR-0079's own
  `buildPlan` always prices "now," never a past instant) — rebuilding then would price a
  different plan than what the user actually saw and chose to diverge from. Rejected.

### Server reprices every edit; the client only ever previews

Every number drag-to-adjust shows while the user is still touching a handle comes from
`previewPlan` (`apps/web/src/modules/plans/preview-plan.ts`), a direct, client-side call into
`engine.priceOperation` — the engine is pure TypeScript with no I/O (ADR-0013), so it runs
identically in the browser, against the same `MarketView`, pricing instant, risk profile and
open-operation count the server already resolved and handed back in `BuildPlanOutcome.preview`.
`previewPlan` rebuilds its own legs through `legsFromTemplate` (`template-legs.ts`), the same
function the server uses, so a preview's quantities carry the structure's own ratio rather than
a flat `lots * 100`. This preview is never saved and never shown as official: on release (a lot
step, a strike step or an expiry chip, not on every pixel of a drag — the chart handle only
calls back when the nearest traded strike under the pointer changes, never on every pixel,
bounding how often this fires), `adjustPlanAction` reprices the exact same edit through the
server's own two-rung, limit-price pricing. That two-rung pricing (`reprice-legs.ts`) is two
functions, not one: `priceFromProbe` turns an already-priced probe into the limit-price rung
alone, and `priceExactLegs` probes a set of legs and then calls `priceFromProbe`. The auto-sized
path's own `priceLot` already has a probe from resolving its `LegSelection` (`legSelectionFor`),
so it calls `priceFromProbe` directly; the user-edited path's own concrete legs have no probe
yet, so `buildEdited` calls `priceExactLegs`. Either way only one probe ever runs per lot count,
and only the final reply ever becomes the plan's official numbers. `LatestRequestWins`
(`apps/web/src/modules/plans/latest-wins.ts`) guards the one race this introduces: a slow reply
to an earlier edit landing after a faster reply to a later one can never un-apply the newer edit.
`savePlanAction` still re-derives and re-verifies the saved plan's own fingerprint from scratch
before writing anything (CLAUDE.md principle 1): an edited save reprices the user's exact legs
and lots again, server-side, rather than trusting the last `adjustPlanAction` reply either.

### The strike handle lives on the payoff chart's own price axis, not only in a range input

The first pass of this ticket answered "each strike is a handle on the payoff chart's price
axis" (the issue's own wording) with a native range input below the chart plus ← → buttons, on
the view that the range input's own keyboard behaviour (arrow keys move its thumb) already
covered the handle's accessibility requirement and a canvas-drawn handle would need its own,
separately-built one. A review of that pass read the issue literally: the handle is a feature on
the chart itself, not an alternative control next to it, so this ticket now draws it there.

- **Where it lives**: `PayoffChart` (`apps/web/src/modules/portfolio/builder/payoff-chart.tsx`,
  shared with the builder's own read-only preview and the open-operations payoff) grows one new,
  optional prop, `handles: readonly PayoffStrikeHandle[]`, absent for every other caller — the
  chart stays exactly the read-only component it always was unless the caller hands it strike
  handles. A `PayoffStrikeHandle` carries only numbers and callbacks (`value`, `min`, `max`,
  `ticks: { value, traded }[]`, `onPreview`, `onCommit`, `onStep`); the chart never resolves a
  strike to a leg, a ticker or a plan — every lookup (`tickerAtStrike`, `leg-strikes.ts`) stays in
  `apps/web/src/modules/plans`, which builds the handle list and owns the engine-facing side of
  every callback. This keeps the chart a deep module with one thin, numbers-only interface rather
  than forking it into a "plans" variant and a read-only one.
- **Pointer events, not HTML5 drag-and-drop**: `pointerdown` sets pointer capture on the handle
  itself (`setPointerCapture`), so the same three handlers (`onPointerDown`/`onPointerMove`/
  `onPointerUp`) answer a mouse, a pen and a touch identically — HTML5 drag-and-drop has no touch
  equivalent and would need a second path for phones anyway.
- **Pixel→strike mapping**: `nearestStrikeAtPixel` (`payoff-chart-layout.ts`) inverts the pointer
  position through the exact same `xScale` the axis itself is drawn with (never a second,
  reconstructed scale) and snaps to the nearest of the given candidates via the chart's own
  `nearestIndex` (unit-tested directly, `payoff-chart-layout.test.ts`); the handle passes it only
  the traded strikes' values, so it can never land anywhere else.
- **Dimmed, untraded strikes stay traded-only on release — considered and rejected letting a drag
  land on one with a warning instead.** `PayoffStrikeHandle.ticks` carries every listed strike
  (`allStrikesFor`, `leg-strikes.ts`), traded or not; the chart draws all of them as small marks
  along the axis, `var(--line)` for a traded one and `var(--faint)` for an untraded one, so the
  user can see where the ladder is denser or thinner. The handle's own rendered position while
  dragging follows the raw pointer continuously (so it visually passes over a dimmed mark rather
  than jumping past it), but the value `onPreview`/`onCommit` ever receive is always the nearest
  _traded_ strike — the same restriction `selectableStrikes` already enforced for the range input
  and the ← → buttons. Letting a drag land on an untraded strike with a warning (mirroring how a
  risk-limit breach surfaces as a warning rather than a refusal) was considered and rejected: an
  untraded strike has no price at the anchor session at all, so previewing or saving against one
  would not be a worse-than-ideal plan, it would be an unpriceable one — `generatePlan`'s and
  `buildAdjustedPlan`'s own stale/no-price refusals exist precisely to keep that out of a plan
  Fetha ever shows as ready to execute.
- **Keyboard**: the handle is a real, focusable element (`tabIndex={0}`, `role="slider"`,
  `aria-valuenow`/`aria-valuetext` in pt-BR `R$` format, `aria-label` naming the leg, e.g.
  "Compra de call, strike"), and its own `onKeyDown` calls `onStep`, the identical function the
  ← → buttons already call (`onStrikeStep` in `plan-adjuster.tsx`) — never a second
  implementation of "the next traded strike." The range input is gone (the handle plus the
  buttons already cover every input method a native range input did); the ← → buttons stay as
  the explicit phone and assistive-technology alternative the issue asks for, not merely a
  side-effect of keeping a slider around.
- **Motion and hit target**: the handle's horizontal movement is a CSS transition
  (`transition-[cx] duration-[120ms]`, `motion-reduce:transition-none`, matching every other
  animated element in the app), disabled while actively dragging (so it tracks the pointer
  exactly, not with a lag) and re-enabled on release, when it snaps visually to the committed
  strike. Its hit area is a 24px-diameter circle (`r={12}`), DESIGN.md's own accent token
  (`var(--accent)`) fill.

### Legs are identified by their template position, never by role+side; the server rebuilds them

A structure can have two legs sharing both a role and a side — a call butterfly's two buy-call
wings — so matching an edit back to "the buy call" is ambiguous. Every leg is instead identified
by its own position in `structure.legs` (`optionLegsOf`/`legsFromTemplate`,
`apps/web/src/modules/plans/template-legs.ts`): the client's `AdjustedLegInput` carries only a
listed ticker per non-stock template slot, in template order; role, side and quantity
(`ratio * lots * 100`, never a flat `lots * 100`) are always rebuilt from the template itself,
never trusted from the client. The same position is what "O que mudou" (`plan-diff.ts`) and every
UI list key the drag-to-adjust screen renders now use.

`validateStructuralAdjustment` (`validate-adjustment.ts`) checks the edit still conforms to that
same template before any engine call: an exact leg count, each listed series' own `right`
matching the template's role and actually traded, one shared expiry, legs at the same strike rank
(a box spread's own paired call/put) landing on the same strike, and strictly increasing strikes
from one rank to the next — refusing a non-conforming edit with a typed `invalid_adjustment`
rather than pricing and saving it under the recipe's structure anyway. The plan's own
20-50-session expiry window (`plan-selection.ts`) is enforced the same way, server-side, not only
in which expiry chips the client renders (`isWithinPlanWindow`, `plan-window.ts`).

### The strike rank, not the leg, is the unit of a strike edit

A straddle's call and put share one strike rank, and the server requires every leg at a rank to
land on the same strike. Editing one of them at a time — the first pass's own per-leg handle and
← → buttons — made every such edit refuse: moving the call left its put behind, moving the put
left its call behind, and `validateStructuralAdjustment` rejects a rank split across two strikes
either way. `leg-strikes.ts`'s `ranksOf` groups a structure's own option legs by `strikeRank`;
the client then draws one chart handle and one row of ← → buttons per rank, not per leg
(`commonSelectableStrikes`/`allStrikesForRank`: only a strike traded for every right present at
that rank is offered), and resolves a rank's own new strike to every one of its legs' own tickers
at once (`tickersForRank` in `plan-adjuster.tsx`) before previewing or committing — always
all-or-nothing, the same shape `onExpirySelect`'s own remap already used for a whole plan.

## Addendum (ticket #381): "Executei" links a plan to the real operation; nightly rule alerts

Ticket #381 closes the loop: "Executei" turns a saved plan into a real, held operation, and the
nightly job alerts the user when the plan's own rules fire against it. No order is ever sent
(CLAUDE.md, the issue's own wording); the user still acts from the Carteira.

- **Link direction and shape.** `operation_plan_rules` grows a nullable `operation_id` column,
  bound by a composite `(operation_id, user_id)` foreign key against `operations(id, user_id)` —
  the same pattern `fills` and the plan's own `contemplated_operation_id` already use — with a
  unique index on `operation_id` so a plan links to at most one operation, and an operation can be
  the target of at most one plan. A second unique index, on `(id, user_id)`, exists only so
  `plan_signals` below can reference this table by that pair: Postgres requires a unique
  constraint on exactly the referenced columns, which the primary key on `id` alone does not
  provide. The plan points at the operation, not the reverse: the operation is still an ordinary
  `operations` row (grouped from fills exactly like any other), and asking it "which plan, if any,
  made you" is the rarer read (the nightly job's own loop, and the Carteira showing a plan as
  executed), so the pointer lives on the rarer-written, already-plan-specific side rather than
  widening every operation with a column only some of them ever use. Migration
  `0051_operation_plan_execution.sql`, additive only.
- **Ungrouping a plan-linked operation unlinks the plan.** The Carteira's "Desagrupar" action
  (`PortfolioRepository.ungroup`) deletes the `operations` row; before this addendum's fix, the
  `operation_id` foreign key above had no `ON DELETE` action, so that delete raised a plain
  23503 and ungrouping a plan-linked operation failed outright. The fix is at the database level:
  the foreign key now reads `ON DELETE SET NULL ("operation_id")`, Postgres's column-list form
  for a composite key (PG15+), which nulls only `operation_id` and leaves `user_id` alone — the
  plain, all-columns `set null` Drizzle's own schema builder supports would instead try to null
  `user_id` too, which is `NOT NULL` and would just trade one failure for another. Drizzle has no
  equivalent of the column-list form, so this one clause is hand-written into the migration SQL
  and the `operation_plan_rules` schema carries a comment recording the gap. The plan itself goes
  back to not executed (`operation_id` reads null again, so it can execute once more), and its
  `plan_signals` rows cascade-delete with the operation they were about, the same as any other
  `operation_id`-scoped row.
- **"Executei" prefills from the plan's own legs, never a per-leg stored price.** A saved plan's
  `contemplated_operations.legs` already carries the exact ticker/role/side/quantity per order
  (ADR-0079's own body); `executePlanAction` reads those, never trusts a client-sent leg — quantity
  is editable from that starting point (a partial fill is still one order), ticker and side are
  not. What the plan does **not** carry is a per-leg limit price — only the totals are stored, by
  design (the body above describes the contemplated operation as storing exactly what it priced
  at save time, nothing more). `planExecutionPrefillAction` therefore prefills each row's price
  from a fresh, live `priceOperationNow` read (the same call the builder's own price button
  makes) rather than "the plan's limit price" literally — a deviation from the orchestrator's
  stated shape, justified because there is no stored per-leg price to read back, and a live price
  is a better starting point for "what did this actually fill at" than a stale build-time number
  would be anyway. That price is formatted pt-BR (`formatDecimal`) before it reaches the dialog:
  `parsePriceInput` only ever accepts pt-BR input, so an unedited, dot-decimal prefill could never
  itself be submitted — a round trip the prefill action's own tests now assert. The user corrects
  every price, quantity and the execution session (defaulting to today in São Paulo, validated the
  same way `recordFillAction` validates one) before saving; nothing from the prefill is trusted
  again once the user submits, and the prefill action itself is rate-limited (`plans/prefill`,
  60/min) since every open of the dialog reprices live.
- **One transaction, atomic — and `plans` never validates a fill itself.** `recordFillsAsOperation
(db, tx, user, session, rawFills)` — the `portfolio` module's one entry point for turning raw,
  unparsed leg input into a new operation — takes each leg exactly as the user typed it: ticker,
  side, quantity, and price/costs still as pt-BR strings. It validates every leg through
  `resolveFillInstrument`, the same function `recordFillAction` calls for its own one fill
  (`fill-validation.ts`): asset class is always read off the option-series lookup, never a
  caller's own guess, so a stock leg gets the same unknown-instrument check (`latestCandle`) an
  option leg's series lookup already gave it for free. Before this fix, `executePlanAction` built
  each `NewFill` itself from the plan's own `leg.role`, which had already drifted from
  `recordFillAction`'s own logic (assetClass guessed from `role` instead of the series lookup, and
  no `latestCandle` check for a stock leg at all) — a second copy of validation a plan's own shape
  could silently fall out of step with. `recordFillsAsOperation` then resolves series and
  corporate-action facts, inserts the fills and groups them into one new operation, all inside
  the caller's `tx`. `executePlanAction` is the only caller: it opens one `db.transaction`, calls
  `recordFillsAsOperation`, then `PlanRulesRepository.linkOperation` with that same `tx`. Before
  the atomicity fix, a refusal from either step was `return`ed from inside the transaction's
  callback, which Drizzle commits on a plain return — only a thrown error rolls a transaction
  back. Both refusals are now a typed `ExecutePlanRefusedError`, thrown inside the callback and
  caught outside it, so a forced grouping refusal (two legs on different underlyings, say) or the
  losing side of two concurrent submits of the same plan both leave zero new fills and zero new
  operations, not an orphan. `PortfolioRepository.insertFills`/`.group` express "run in the
  caller's own transaction, or open a fresh one" as a plain method overload (`tx?: Transaction`)
  rather than a runtime `Database | Transaction` union checked at the call site — the union
  version needed an `executor as Transaction` cast to tell the two apart; the overload needs none,
  since the caller's own argument is already typed `Transaction`. `linkOperation`'s own `where`
  clause still requires the plan's `operation_id` to be null, so the loser of two concurrent
  "Executei" submits is the one whose `linkOperation` call returns no rows, not a race on who
  reads first; the unique index on `operation_id` is the second, database-level guarantee behind
  it. `plans` reaches into no portfolio internal directly — `recordFillsAsOperation` (and its
  `RecordFillsAsOperationResult`/`RawFillInput` types), `loadPortfolio`/`OperationRow` (the
  nightly step's own read) and the already-existing `OperationsRepository`/`priceOperationNow` are
  the whole seam. The portfolio module's public index carries none of `PortfolioRepository`,
  `NewFill` or `GroupResult`: the one other caller that needed `PortfolioRepository` for a single
  method (`plans`' own ungroup-unlinks-the-plan test) imports it from its own file
  (`@/modules/portfolio/portfolio-repository`), the pattern every other cross-module integration
  test already used for a repository it needs but the production code across that boundary never
  does.
- **An executed plan cannot execute again.** `planExecutionPrefillAction` and `executePlanAction`
  both refuse with `already_executed` once `operation_plan_rules.operation_id` is set — checked
  up front (a fast, friendly refusal) and enforced again by `linkOperation`'s own conditional
  update (the actual race guard).
- **The journal gains no new decision.** The plan's own "enter" decision was already recorded
  when it was saved (ADR-0079's round-1 addendum); "Executei" is the user acting on a decision
  already in the journal, not a new one — the existing `held_operation` origin (ADR-0022) already
  covers whatever the user records next about the position it became.
- **Nightly alerts: a new `plan_signals` table, not the strategy signal inbox.** `signals` (the
  strategy catalog's own inbox) carries machinery a plan alert has no use for and would have to
  work around: a `NOT NULL` `strategy_version_id` foreign key a plan simply has none of; an
  append-only trigger that forbids updating a row once written, which rules out a `supersededBy`-
  style "this one replaced that one" edit; the ADR-0047 supersession machinery built on top of
  that trigger, sized for re-evaluating a strategy's own signal history, not a plan's one-shot
  rule check; and `decisions` rows that reference a `signals.id` directly, which a plan alert must
  never participate in (ADR-0079's own point above: "Executei" produces no new decision). Making
  `strategy_version_id` nullable and dropping to Postgres's `NULLS NOT DISTINCT` would solve only
  the narrow dedup problem (two NULLs normally compare unequal in a unique index; that modifier
  makes them compare equal) — it does nothing about the trigger, the supersession machinery or
  the decision linkage, so it would still leave `plan_signals` needing to coexist inside a table
  shaped for a different kind of row. `plan_signals` is a small, dedicated table instead:
  `user_id`, `operation_plan_rules_id` and `operation_id` (both composite-FK'd the same way as the
  rest of this schema, cascading on delete), `kind` (`target_hit` | `stop_hit` | `roll_due` |
  `expiry_near`), `session`, `at`. Its own unique index is `(user_id, operation_id, kind)`, backed
  by a `clearStale` delete (not append-only): every nightly run re-evaluates every kind it has the
  pricing to check and deletes any of this operation's rows whose kind it evaluated but did not
  find firing, so "don't re-alert every night" is "insert what newly fires, delete what no longer
  does" — a condition that clears and later fires again does alert a second time, unlike a plain
  `onConflictDoNothing`-only table would. The `/sinais` page reads both sources and renders the
  plan ones in their own panel (`PlanSignalsPanel`), read-only, no decision bar —
  `firedPlanSignalKinds`'s own kinds are an alert to act on, not a journal entry to score the way a
  strategy's `entry`/`exit`/`adjust` signal is.
- **The rule-firing math mirrors the engine's own exit-rule evaluation, without depending on its
  internals — and is entry-priced, not mark-priced.** `evaluateNumericExitRule` and
  `computeExitRuleBases` (`packages/engine/src/internal/evaluate-strategy.ts`) are not part of the
  frozen public interface (ADR-0013); `plan-signal-rules.ts`'s `firedPlanSignalKinds` reimplements
  only the comparison over bases its caller resolves, mirroring the engine's own choice to price
  every leg "given" at its own `entryPrice` rather than today's spot, so the base never drifts as
  the position moves. `evaluate-plan-signals.ts` resolves `premiumBaseCentavos`/
  `maxLossBaseCentavos` from `OperationRow.entryPayoff` (`engine.priceOperation` at each leg's
  entry price, already computed by `loadPortfolio` for the Carteira's own P&L breakdown) rather
  than from today's mark pricing — pricing a short option's stop against its own drifting mark
  premium could put the stop multiple past 1 and never fire, or fire a profit target at the wrong
  fraction entirely. Target and stop are skipped (not fired, not cleared) when `entryPayoff.kind`
  is not `"priced"` (a corporate action since opening, or a pricing failure) or when today's mark
  pricing itself carries a `no_market_price` note, since `unrealizedPnl` is derived from that same
  mark; a lone `iv_not_converged` note is not a skip condition — it fires when a leg has a market
  price but no greeks (a deep-ITM short priced below intrinsic, say), and the engine's own
  `evaluateNumericExitRule` still treats that mark and the `unrealizedPnl` derived from it as
  valid. Roll and expiry-near need no price at all, so they are evaluated regardless. Every `ExitRule` kind is matched exhaustively: `days_before_expiry` resolves to its
  own `expiry_near` kind rather than being silently dropped (its already-resolved
  `ResolvedExitRule.session`, computed once at save time against the series the plan actually
  listed, is compared to today's session, the same way roll due is); `condition` exit rules
  evaluate an indicator-based `Condition` this nightly step has no indicator evaluation for, so
  they never fire here — a documented gap for a future ticket, not a silent one. CLAUDE.md
  principle 1 ("AI never produces numbers") is satisfied the same way
  `modules/portfolio/bookkeeping.ts`'s own ledger arithmetic already is (ADR-0021 item 3): this
  module invents no number of its own, it only compares numbers the engine already produced.
- **The nightly step's own loop.** `evaluatePlanSignals` is chained right after decision scoring
  (the same `asOfSession` every other scoring step reads), looping over `executedPlanUserIds`
  (every user with at least one `operation_plan_rules.operation_id is not null` row) and, per
  user, one `loadPortfolio` call shared across every one of that user's linked plans — not one
  `loadPortfolio` per plan. A user with no executed plan still linked to an open operation is
  counted as evaluated, not skipped from the count entirely. It honours the shared `deadlineAt`
  budget the same way `evaluateSignalsForSession`/`scoreDueDecisions` do (a user not yet reached
  when the deadline passes is `usersSkipped`, picked up again the next run) and is reported in
  `nightly_runs`' own redacted report (`planSignalScoring { usersEvaluated, usersSkipped,
signalsWritten, signalsCleared, errorCount }`, ADR-0045's addendum pattern) and in
  `NightlyJobOutcome`. It writes to `plan_signals`, its own store — not "the signal inbox",
  `signals`, which stays strategy-scoped. A plan's linked operation that is no longer open
  (settled, rolled away, or pending its own settlement) clears every kind `plan_signals` still
  has for it (`clearStale(operationId, planSignalKinds, [])`) rather than leaving a stale
  `target_hit` on `/sinais` for a position the user no longer holds (review round 2, #381); the
  read side defends the same thing independently — `getMyPlanSignals` joins each signal's
  operation through `getMyPortfolio`'s own open operations, so a signal in the narrow window
  before the next nightly run clears it is left out of the list rather than shown, not just
  deduplicated.
- **A plan alert links to the real operation, not the Carteira's own front page.**
  `PlanSignalListEntry` carries the operation's own id, not only its underlying, so
  `PlanSignalsPanel`'s own "ver carteira" link on `/sinais` points at
  `/carteira/operacoes/<operationId>` — the same operation page #388 added — instead of the
  generic `/carteira` list the user would have had to search through themselves.

## Alternatives considered

- **One new table carrying the full operation (structure, legs, pricing) plus the rules.** Forks
  the model `contemplated_operations`, held operations and the journal already share; a plan and
  a builder-typed operation would need two save paths, two isolation tests, two read paths in the
  Carteira. Rejected.
- **Store the rules as a new jsonb column on `contemplated_operations` itself.** Every other
  saved operation (the builder's) would carry a null column for a concept that only applies to a
  plan; a one-to-one side table keeps the existing table's shape exactly as every other reader of
  it already expects. Rejected.
- **Resolve the series by querying the option chain directly in `apps/web`.** Would duplicate
  `priceOperation`'s own `LegSelection` resolution (ADR-0013's frozen interface) outside the
  engine. Rejected.
