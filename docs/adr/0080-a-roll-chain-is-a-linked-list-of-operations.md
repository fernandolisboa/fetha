---
status: accepted
date: 2026-11-21
---

# A roll chain is a linked list of operations, not a new table (amends ADR-0021)

## Context

Amends ADR-0021 item 4, which read "adjusted and rolled lifecycles stay out of v1": a rolled
lifecycle ships after all, through this ADR. Adjusted lifecycles (changing a held operation's
legs without closing it) are still out of v1.

Ticket #382 ("Rolar" in the Carteira) asks for three things against a held operation: a
"Rolar" action that proposes closing the current legs and opening the next monthly expiry's
(same structure, strikes by the same rule ticket #379/ADR-0079 already uses), a roll agenda on
Início and Carteira naming which open operations need a decision soon and what to do, and a
roll-chain history showing what each month's roll received or paid, the month's result and a
running total, exportable as CSV. The owner used to track this by hand in a spreadsheet, one row
per month; the ask is to replace that spreadsheet, not to re-model it.

Fetha already has `operations` (ADR-0021, grouped from fills, marked to market) and the engine's
own `Operation.rolledFrom` (packages/engine `api.ts`), a seam that already exists for exactly
this and that every mapping in `apps/web` has fed a hardcoded `null` since it was added.

## Decision

A roll chain is not a new table: it is the existing `operations` table with one new nullable
self-referencing column, `rolled_from_operation_id`, and a composite foreign key on
`(rolled_from_operation_id, user_id)` against `operations`' own `(id, user_id)` unique index
(`operations_id_user_id_idx`) — the same pattern `operation_plan_rules` already uses against
`contemplated_operations` (ADR-0079). The database, not the repository, refuses a roll that
would point at another user's operation. Migration `0050_roll_chain.sql`.

Recording a roll (`PortfolioRepository.roll`) is one transaction, the same shape `settle`
already has: it inserts the closing fills against the source operation and re-plans it from its
whole fill set — refusing, as a conflict, if that replan does not actually come out closed, since
a proposal priced before a user edited the close is no longer the operation it is closing — then
it closes the source operation (`status: "closed"`), inserts the opening fills as a brand new
operation, and groups them with `rolled_from_operation_id` set to the source. Executing a roll is
always one atomic "close this, open that"; there is no partial roll.

A roll's own numbers (which legs to close, which to open, strikes and expiry, the net
credit/debit) come from two calls to the engine's `priceOperation`, assembled by
`roll/roll-proposal.ts`, a pure function: `closing` is the engine pricing the held operation's
legs with each side reversed (closing a short is a buy), `opening` is the engine pricing the next
monthly expiry's legs at the same strike rule ticket #379 already resolves
(`plans/monthly-expiry.ts`, `plans/generate-plan.ts`'s own series selection). The net credit/debit
is simply `closing.netPremium + opening.netPremium`; the AI never computes either number
(CLAUDE.md principle 1).

The roll agenda's suggested action (`roll/roll-agenda.ts`) is a small, explicit, three-way rule
over engine-computed facts only (moneyness at the last close, sessions to expiry,
`plans/exit-rules.ts`'s `rollTriggerSessionsBeforeExpiry`, the same number `resolveRollRule`
already names for the plan screen — exposed as a raw business-day count rather than a second
calendar resolution, since the agenda already has its own "sessions to expiry"):

1. A short leg already in the money with one session or fewer left is flagged
   `close_early_assignment_risk`, regardless of the structure's own roll rule — close enough to
   expiry that a broker's automatic exercise could land before the user next opens the app.
2. Otherwise, once `sessionsToExpiry` reaches the structure's own roll trigger, it is `roll`.
3. Otherwise it is `let_expire`.

An operation outside a ten-session window is left out of the agenda entirely: nothing to decide
yet.

The roll-chain history is the chain walked from any operation through its `rolledFromOperationId`
pointers, each hop's realized result (closing cash flow plus, for the chain's last link, the
position's own settlement) grouped by the calendar month it landed in
(`roll/roll-chain.ts`'s `aggregateRollChainByMonth`), with a running total carried forward in
integer centavos, no `decimal.js` needed since centavos addition never leaves the integers. CSV
export (`rollChainToCsv`) renders plain decimal numbers (`"5.00"`, not `"R$ 5,00"`) and ISO month
keys, not the screen's own pt-BR formatting: a script or spreadsheet re-reading the file should
never have to locale-parse it.

## Consequences

- No new table, no new isolation surface beyond the one `operations` already has; the existing
  isolation test for `operations`/`fills` covers the new column's own foreign key by extension,
  and `roll/roll-repository.integration.test.ts` adds the roll-specific case (user B cannot roll
  user A's operation).
- `rolled_from_operation_id` is included in account data export and deletion the same way every
  other `operations` column already is (`PortfolioDataExport`, `account/data-export.ts`): no
  separate LGPD wiring needed, since it is not a new table.
- The backtester still ignores roll rules entirely (`adjustment_not_applied`, #383); this ADR
  covers only the Carteira's own recording of a roll a human executed, never an automatic one.

## Addendum (round 2): the agenda's trigger without a cheap plan link, and roll by leg

The body above left two things to the orchestration ticket (#382's remaining slice): how the
"Rolar" proposal picks each leg's own next series, and what the roll agenda's suggested-action
rule (`roll/roll-agenda.ts`'s `rollTriggerSessions`) uses when an operation has no saved plan to
read a structure-specific trigger from.

- **Roll by leg, never by inferred structure**: the orchestrator (`roll/roll-plan.ts`,
  `roll/roll-resolve.ts`) never looks at an operation's legs and guesses which structure they
  form. Each option leg rolls on its own: same right, nearest strike to its own held strike at
  the next monthly expiry (`roll/roll-series-selection.ts`, already shipped), same side and
  quantity reopened, side reversed to close. A stock leg (a covered call's own stock) is left out
  of the roll entirely — there is nothing to roll for it. One leg's own failure (no later monthly
  expiry, or none of it traded) refuses that leg with its own ticker in the error, not the whole
  operation guessed as some other shape.
- **No cheap plan link exists today**: the intended design (checking whether the operation is
  "cheaply linkable to a saved plan" and reusing that plan's own `rollTriggerSessionsBeforeExpiry`)
  assumed a join from a held `operations` row back to the `contemplated_operations`/
  `operation_plan_rules` row it was saved from (ADR-0079). No such column exists: `operations` and
  `contemplated_operations` are different id spaces, and the only place that ever recorded a link
  between them is a `decisions` row's `contemplatedOperationId` — which a `held_operation` decision
  never carries (the schema's own check constraint keeps `contemplatedOperationId` and
  `operationId` mutually exclusive, ADR-0022). Executing a plan into a real operation (#380/#381)
  does not yet write that link either. So, today, every operation the agenda considers is in the
  "no link" case.
- **The agenda's own default**: `roll/roll-agenda-queries.ts` passes a fixed five-session trigger
  (`DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY`, the same number `plans/exit-rules.ts`'s own constant of
  that name already defaults a structure's roll rule to when its recipe names no
  `days_before_expiry` exit rule) for every open operation that still carries an option leg,
  rather than restricting the agenda to the "rollable" structures `plans/exit-rules.ts` names
  (`covered-call`, `bull-put-spread`, `bear-call-spread`): with no structure known, there is
  nothing to check that set against. The two modules duplicate this one literal (`5`) rather than
  share an export, since `plans` does not expose it and a dependency the other way would couple
  `portfolio`'s own agenda to a plan-screen default that is a coincidence of today's catalog, not
  a shared invariant. Once execution linking (#380/#381) lets an operation name the plan it came
  from, the agenda should read that plan's own trigger instead — this default is this ticket's
  interim, not the final rule.

## Addendum (round 3): review fixes

- **The roll is atomic.** `PortfolioRepository.roll` throws a typed `RollRefusal` on every
  post-write refusal instead of returning `{ ok: false }` from inside `db.transaction`: a bare
  return still commits whatever the callback already wrote, so every refusal path now throws
  and the transaction rolls every write of that attempt back, including the one that refuses
  because the newly opened operation would not come out `open`.
- **A covered call rolls.** The stock leg is never closed, never repriced, and never part of the
  pricing proposal's two legs of pricing: `PortfolioRepository.roll` reads the source operation's
  current fills, splits them by `assetClass`, replans the source as closed from its non-stock
  fills plus the closing fills, and carries every stock fill forward by reassigning its
  `operationId` to the new operation — `fills` has no immutability trigger (unlike `decisions` or
  `backtest_runs`, ADR-0009/ADR-0008), so moving `operationId` is the natural fit and keeps the
  stock leg's own average cost exactly as it was, fill for fill, rather than approximating a new
  cost basis.
- **The series map covers the operation's whole fill history, not only today's legs.** The
  repository replans the source operation from every fill it has ever carried, including a
  ticker that closed earlier in its life; `recordRollAction` now builds its `SeriesByHolding` from
  `seriesByHolding(db, operationFills)` over the operation's complete fill history, merged with
  the opening legs' own target series (the only facts not yet in that history), rather than from
  only the legs currently rolling.
- **The execution session is the user's, not the pricing session.** A roll is priced against the
  latest ingested candle's own session (`roll-resolve.ts`'s `resolvePricingSessionFor`, unchanged)
  but recorded against the session the user names when confirming it, validated the same way
  `recordFillAction` validates a fill's own session (not in the future, a trading session that has
  already opened). The dialog defaults this field to today but the user can backdate it to the
  day they actually executed the roll. `loadPortfolio` still silently drops an operation whose
  `openedAt` is after the mark session it is being valued at (ADR-0021's own guard against a
  mis-dated fill); a roll executed today, before the day's own candle has been ingested, can
  briefly hit that same gap for the new operation. Left as-is: closing it needs a same-day
  ingestion guarantee this ticket does not add, and the gap self-heals once the day's candle
  lands.
- **Recording a roll does not journal a decision.** Unlike executing a saved plan (#380/#381),
  confirming a roll writes only the fills and the two operations; it never writes a `decisions`
  row. Journaling the executed roll as an `adjust` decision is #381's own scope, not this one's.
- **Assignment risk is the literal strike-vs-spot comparison, never the builder's own display
  band.** `roll/roll-assignment-risk.ts`'s `isShortLegAssignmentRisk` compares a short leg's
  strike to the last close directly (`spot >= strike` for a call, `spot <= strike` for a put, so
  at-the-money counts as risky too); the builder's series-picker `moneyness` exists only so two
  adjacent rows in a picker never flip labels on a rounding difference, and reusing it here missed
  a call struck fractionally below spot because it fell inside that display band. The sessions-
  to-expiry count the agenda compares against the roll trigger is anchored on today
  (`todaySaoPauloDate()`), not on the latest ingested candle's own session, so the "vence hoje"
  branch can actually fire on the expiry day itself even before that day's own candle lands.
- **A short leg already in the money, before its own roll trigger or the one-session
  assignment-risk window, is `watch`, not `let_expire`.** `let_expire` is reserved for a position
  every short leg of which is out of the money.
