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

**Roll by leg, never by inferred structure.** The orchestrator (`roll/roll-plan.ts`,
`roll/roll-resolve.ts`) never looks at an operation's legs and guesses which structure they form.
One shared next monthly expiry is chosen first, from the full monthly chain before it is narrowed
to traded series (`roll/roll-series-selection.ts`'s `selectNextMonthlyExpiry`), so an expiry with
no traded series yet still counts as the next one and `no_traded_series` stays its own, later
refusal, and so a strangle or collar's legs can never land on two different expiries. Only then
does each leg pick its own nearest strike to its own held strike at that one expiry
(`selectNearestStrikeAtExpiry`), same side and quantity reopened, side reversed to close. A stock
leg (a covered call's own stock) is left out of the roll entirely — there is nothing to roll for
it. The plan refuses the whole roll, not leg by leg, when two legs would resolve to the same
ticker (`duplicate_ticker`) or when the strike width between legs would change
(`strike_width_changed`): either would silently turn the structure the user holds into a
different one. One leg's own failure to find a traded series at the shared expiry refuses that
leg with its own ticker in the error, not the whole operation guessed as some other shape.

A roll's own numbers (which legs to close, which to open, strikes and expiry, the net
credit/debit) come from two calls to the engine's `priceOperation`, assembled by
`roll/roll-proposal.ts`, a pure function: `closing` is the engine pricing the held operation's
legs with each side reversed (closing a short is a buy), `opening` is the engine pricing the
legs `roll/roll-plan.ts` resolved above. The net credit/debit is simply
`closing.netPremium + opening.netPremium`; the AI never computes either number (CLAUDE.md
principle 1).

**Recording a roll is one atomic transaction**, the same shape `settle` already has:
`PortfolioRepository.roll` inserts the closing fills against the source operation and re-plans it
from its whole fill set — refusing, as a conflict, if that replan does not actually come out
closed, since a proposal priced before a user edited the close is no longer the operation it is
closing — then it closes the source operation (`status: "closed"`), inserts the opening fills as
a brand new operation, and groups them with `rolled_from_operation_id` set to the source. It
throws a typed `RollRefusal` on every post-write refusal instead of returning `{ ok: false }`
from inside `db.transaction`: a bare return still commits whatever the callback already wrote, so
every refusal path, including the one that refuses because the newly opened operation would not
come out `open`, rolls every write of that attempt back. Executing a roll is always one atomic
"close this, open that"; there is no partial roll.

**A covered call's stock leg carries forward, not rolled.** It is never closed, never repriced,
and never one of the proposal's two legs of pricing: `PortfolioRepository.roll` reads the source
operation's current fills, splits them by `assetClass`, replans the source as closed from its
non-stock fills plus the closing fills, and carries every stock fill forward by reassigning its
`operationId` to the new operation — `fills` has no immutability trigger (unlike `decisions` or
`backtest_runs`, ADR-0009/ADR-0008), so moving `operationId` is the natural fit and keeps the
stock leg's own average cost exactly as it was, fill for fill, rather than approximating a new
cost basis.

**The series map covers the operation's whole fill history, not only today's legs.** The
repository replans the source operation from every fill it has ever carried, including a ticker
that closed earlier in its life; `recordRollAction` builds its `SeriesByHolding` from
`seriesByHolding(db, operationFills)` over the operation's complete fill history, merged with the
opening legs' own target series (the only facts not yet in that history), rather than from only
the legs currently rolling.

**The execution session defaults to, and can never be later than, today**, the same default
`RecordFillDialog` uses: a roll at any time today is recordable today whether or not today's own
session has closed yet. It can never be earlier than the source operation's own last fill either
(`recordRollAction` refuses with `invalid` otherwise): closing the source before a fill that
opened it further would store `closedAt` before that fill's own session. A roll is priced against
the latest ingested candle's own session (`roll-resolve.ts`'s `resolvePricingSessionFor`,
unchanged) but recorded against the session the user names when confirming it.

**Recording a roll does not journal a decision.** Unlike executing a saved plan (#380/#381),
confirming a roll writes only the fills and the two operations; it never writes a `decisions`
row. Journaling the executed roll as an `adjust` decision is #381's own scope, not this one's.

**No cheap plan link exists today.** The roll agenda's suggested-action rule
(`roll/roll-agenda.ts`) cannot read a structure-specific roll trigger from a saved plan: the
intended design (checking whether the operation is "cheaply linkable to a saved plan" and reusing
that plan's own roll trigger) assumed a join from a held `operations` row back to the
`contemplated_operations`/`operation_plan_rules` row it was saved from (ADR-0079). No such column
exists: `operations` and `contemplated_operations` are different id spaces, and the only place
that ever recorded a link between them is a `decisions` row's `contemplatedOperationId` — which a
`held_operation` decision never carries (the schema's own check constraint keeps
`contemplatedOperationId` and `operationId` mutually exclusive, ADR-0022). Executing a plan into a
real operation (#380/#381) does not yet write that link either. So, today, `roll/roll-agenda-
queries.ts` passes a fixed five-session trigger (`DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY`, the same
number `plans/exit-rules.ts`'s own constant of that name already defaults a structure's roll rule
to when its recipe names no `days_before_expiry` exit rule) for every open operation that still
carries an option leg, rather than restricting the agenda to the "rollable" structures
`plans/exit-rules.ts` names (`covered-call`, `bull-put-spread`, `bear-call-spread`): with no
structure known, there is nothing to check that set against. The two modules duplicate this one
literal (`5`) rather than share an export, since `plans` does not expose it and a dependency the
other way would couple `portfolio`'s own agenda to a plan-screen default that is a coincidence of
today's catalog, not a shared invariant. Once execution linking (#380/#381) lets an operation name
the plan it came from, the agenda should read that plan's own trigger instead — this default is
this ticket's interim, not the final rule.

**Assignment risk is the strike-vs-spot comparison plus a 1% band, the same width the builder's
own display band uses, reused here deliberately.** `roll/roll-assignment-risk.ts`'s
`isShortLegAssignmentRisk` flags a short leg in the money (`spot >= strike` for a call,
`spot <= strike` for a put) or within 1% of spot either way: close enough that one session's own
move could put it there. This is the same width the builder's series-picker `moneyness` uses for
its own "at" band, reused here deliberately rather than the stricter literal-only comparison an
earlier pass tried: a call struck fractionally above spot is still a real assignment-risk
candidate, not safely out of the money. A long leg never gets that band: `isInTheMoney`, the
same module's plain comparison with no band, is what the agenda checks a long leg against,
since B3 would auto-exercise it exactly at the money, never "close to" it. The sessions-to-
expiry count the agenda compares against the roll trigger is anchored on the caller's own
`today` (`rollAgendaFor`'s own parameter, defaulting to `todaySaoPauloDate()` for every real
caller; an integration test injects a fixed one), not on the latest ingested candle's own
session, so the "vence hoje" branch can actually fire on the expiry day itself even before that
day's own candle lands.

**The roll agenda's suggested action (`roll/roll-agenda.ts`) is a four-way rule** over the
market-data strike and close, compared in `roll-assignment-risk.ts` (moneyness at the last
close, sessions to expiry, the fixed trigger above):

1. A short leg already in the money (by the band above) with one session or fewer left is
   flagged `close_early_assignment_risk`, regardless of the structure's own roll rule — close
   enough to expiry that a broker's automatic exercise could land before the user next opens the
   app.
2. Otherwise, once `sessionsToExpiry` reaches the operation's own roll trigger, it is `roll`.
3. Otherwise, `let_expire` applies only when the operation has a short leg, every short leg is
   out of the money, and no long leg is in the money: B3 auto-exercises an in-the-money long on
   the holder's behalf, so a long-only position, or a short-leg position whose long leg is itself
   in the money, is never told it is safe to do nothing.
4. Every other case — an in-the-money short short of the assignment-risk window, or moneyness
   the agenda could not compute at all (a missing candle or a leg's own series facts) — is
   `watch`. A missing candle narrows the operation to "moneyness unknown", it never drops the
   operation from the agenda outright: there is still a `sessionsToExpiry` to show and a human
   to ask.

An operation outside a ten-session window is left out of the agenda entirely: nothing to decide
yet. `filterToMonthlyExpiries` and `isB3MonthlyExpiry` live in `market-data/monthly-expiry.ts`,
not `portfolio`, even though only the roll orchestrator calls them today: `plans` depends on
`portfolio`, so a future `plans` caller of the same monthly-expiry rule could never import it
from `portfolio` without a cycle.

**A held-operation decision scores from the operation's own fills plus every fill in its
recorded `heldFillIds`, whichever operation owns them now.** `held-operations.ts`'s
`heldOperationForScoring` unions a decision's target operation's current fills with the fills
named by the decision's own `heldFillIds` (ADR-0022), because a roll (this ticket) carries a
covered call's stock leg forward by reassigning its `operationId`: a decision recorded against
the source operation, before the roll, would otherwise lose that stock leg's own fills from its
score the moment the roll moves them to the new operation. This amends ADR-0022 item 4's "the
operation's fills".

The roll-chain history is the chain walked from any operation through its `rolledFromOperationId`
pointers, each link's own net credit/debit — its own option fills' net cash flow (`cashCentavos`
with no declared capital, filtered to `assetClass === "option"`; a covered call's stock leg,
carried forward untouched by every roll, is never roll cash) grouped by the calendar month it
landed in (the month it closed in for a closed link, the month it opened in for the still-open
one — read from `rolledFromOperationId`'s own parent when the link itself carries no `closedAt`
yet, never from `openedAt`, which a carried-forward stock fill can read as much older than the
roll that actually created the link; `roll/roll-chain.ts`'s `aggregateRollChainByMonth`), with a
running total carried forward in integer centavos, no `decimal.js` needed since centavos addition
never leaves the integers. The chain's still-open last link is named on its own row
(`openOperationId`) so the screen can label its premium "em aberto" rather than imply it is a
realized net. CSV export (`rollChainToCsv`) renders plain decimal numbers (`"5.00"`, not
`"R$ 5,00"`) and ISO month keys, not the screen's own pt-BR formatting: a script or spreadsheet
re-reading the file should never have to locale-parse it.

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
- `loadPortfolio` still silently drops an operation whose `openedAt` is after the mark session it
  is being valued at (ADR-0021's own guard against a mis-dated fill); a roll executed today,
  before the day's own candle has been ingested, can briefly hit that same gap for the new
  operation. Left as-is: closing it needs a same-day ingestion guarantee this ticket does not
  add, and the gap self-heals once the day's candle lands.
