---
status: accepted
date: 2026-11-21
---

# A roll chain is a linked list of operations, not a new table

## Context

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
