---
status: proposed
date: 2026-09-25
---

# Decisions on held operations are scored on the position held and the portfolio's own fills

## Context

Issue #108 follows #26 (ADR-0021 item 1). A user can now hold real operations, grouped from
their fills, but the journal only accepts decisions on signals and contemplated operations, and
scoring rebuilds every operation from a snapshot with no realized fills (ADR-0014 Q54, "Inputs
until the portfolio exists"). The issue asks for a `held_operation` origin with the kinds that
fit a position already held, scoring with the portfolio's realized fills (an option closed at
zero on exercise counting as realized P&L), isolation tests, journal and track record, and the
LGPD export. It leaves open what the position at decision time is, how later fills enter the
score and what happens to a grouped operation once the journal points at it. The implementing
agent picked the defaults below on 2026-09-25; they are pending the owner's review on the PR.

## Decision

1. **Origin and kinds.** `held_operation` is a third journal origin next to `signal` and
   `contemplated_operation`. Its kinds are hold, adjust and exit. A decision is accepted only on
   an operation that is open and not pending settlement (its expiry session has not closed), the
   same set the dashboard marks. A held operation takes any number of decisions over its life,
   one each time the user reassesses it; `/carteira` shows the latest next to the decision bar on
   each open operation row.
2. **Reference.** `decisions.operation_id` points at the portfolio's `operations` row through a
   composite foreign key on `(operation_id, user_id)`, so a decision can never reference another
   user's operation. With the default `no action` on delete, an operation that has decisions can
   no longer be ungrouped: the delete is refused and the user sees why. The append-only journal
   therefore never points at an operation that no longer exists.
3. **Snapshot.** The decision stores the position as the user saw it: underlying, expiry, opened
   session, the legs at their average cost (ADR-0021 item 3) and the ids of the operation's fills
   at that moment.
4. **Scoring.** The engine's `Operation` and `realizedFills` are derived from the operation's
   fills at scoring time, since fills are the only stored fact (ADR-0021 item 2):
   - _Position at the decision._ A fill in the snapshot belongs to it, whatever its session. A
     fill recorded later belongs to it when its session closed at or before the decision
     instant (a trade entered late), and is a response to the decision otherwise. The legs are
     the net of those fills with the average cost as `entryPrice`, so the score runs from the
     operation's actual entry (ADR-0014 Q54, "from the legs' entry prices").
   - _After the decision._ Each later fill up to the horizon session carries its session close as
     its instant (the Negociação export has no time of day). It closes the open side of its
     ticker first: that part is a realized fill, with the fill's recorded costs pro rata. Any
     excess opens or adds to that side and is merged into one leg per ticker and side at the
     weighted average price. A leg's P&L is linear in its fills, so the merge leaves the cash-flow
     P&L unchanged (property-tested). Fills after the horizon close are ignored.
   - _Exercise and assignment._ The settlement flow's fills are ordinary fills: the option leg's
     closing fill at zero price is a realized fill (the premium realized), and the delivered or
     received stock either closes the operation's stock leg or opens one at the strike, which is
     then marked to the horizon close or closed by a later fill.
   - _Costs._ Entry costs follow Q54 on every leg, from the decision's stored cost model; a
     fill's own recorded costs apply to the part of it that closes a leg.
   - _Origin._ The engine origin is `manual` (no strategy behind a held operation), so there is no
     counterfactual; hold, adjust and exit never had one.
   - _Refusals._ A position empty at the decision, an option series unknown to the reference data
     or a later fill on a date missing from the calendar make the decision unscorable with that
     reason (`build_failed:…`), never a silent zero.
5. **Horizon default.** The operation's expiry, when it is not already past; a stock-only
   operation has none and the user picks one.
6. **Journal and track record.** The journal labels the origin "Operação em carteira" with the
   underlying. The track record aggregates every scored decision, so these count with no change.
7. **LGPD.** No account data export or access audit log exists yet (#31 is open). When #31 builds
   them, they must include `decisions` of every origin with their `operation_id`, and
   `decision_scores`.

## Consequences

- The engine's `score` settled every remaining leg once the operation's expiry had passed, so a
  stock leg left after realized fills closed every option leg (an assigned put, a covered call
  whose call closed at zero) reached `proposeSettlement` as a stock-only operation with an
  expiry, which the coherence check refuses. It now settles only while an option leg remains and
  marks a stock-only remainder at the horizon close. The interface is unchanged.
- `portfolio` exposes `getMyHeldOperation` (the action's read) and `heldOperationForScoring`
  (the job's read, for the decision's own user); the derivation is a pure function,
  `realized-operation.ts`, next to the rest of the bookkeeping (ADR-0021 item 3).
- `PortfolioDashboard` takes a decision slot the page fills in, because `decisions` depends on
  `portfolio` and the reverse import would add a cycle.

## Known limitations

- The max loss that normalizes the P&L is the max loss of every leg held between the decision
  and the horizon, taken together. For an adjusted, rolled or assigned operation it overstates
  the risk actually carried at any one time, so its normalized P&L is smaller in magnitude.
- A later fill whose opening part adds to a leg is costed by the model at the merged entry
  price, not by its own recorded costs.
- Corporate actions are still not applied to fills (ADR-0021 limitation), so a split between the
  opening and the horizon rebases the entry only as far as the engine's own factors allow.

## Considered options

- Scoring from the mark at the decision instant (what happened after the decision only):
  closer to judging the hold or exit itself, but the engine takes entry prices and realized fills,
  not a valuation baseline, and Q54 already defines a taken operation's P&L from its entry. The
  thesis claim and its Brier score remain the measure of the decision's own judgment.
- Letting the engine settle an exercised option at intrinsic value instead of reading the
  settlement fills: exact at the expiry close, but it ignores the outcome the user confirmed or
  corrected, and the stock received could not be followed to the horizon.
- `on delete set null` on the operation reference: it would rewrite an append-only journal row,
  which the `decisions_no_update` trigger refuses anyway.
