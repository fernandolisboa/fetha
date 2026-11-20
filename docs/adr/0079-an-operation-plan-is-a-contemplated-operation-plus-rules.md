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
- A saved plan looks, in the Carteira, exactly like any other saved operation, since it is one; a
  plan screen reads its extra row to show the rules a plain saved operation has none of.
- Deleting a user cascades through `operation_plan_rules` the same two ways `fills` does: via its
  own `user_id` and via its contemplated operation's cascading delete.
- `recipe_id` is stored, not foreign-keyed: the recipe book is a static file, not a table (ADR-0064
  already treats it that way for `signals`/`suggestions`), so a recipe retired from the book still
  reads back from an old plan's row.

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
