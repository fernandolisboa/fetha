---
status: accepted
date: 2026-09-27
---

# `fixed_fractional` sizes a net-debit structure on max(premium, bounded max loss) (amends 0013)

## Context

Issue #131. ADR-0013's `#59` addendum ("Sizing: `zero_units` and the non-debit divisor") gave
`fixed_fractional` two divisors: a non-debit structure (`netPremium >= 0`) sizes on its bounded
max loss, and a net-debit structure sizes on the premium paid. That addendum already named the
gap it left open: "A net-debit structure still sizes on the premium paid; when it carries a short
leg its max loss can exceed that premium, and today the risk-limit check is what catches it
(issue #131: size net-debit structures on bounded max loss too)."

The gap is real, not theoretical: sell put 28 @ R$1.00, buy call 32 @ R$3.00, spot R$30,
`declaredCapital` R$10,000, `fixed_fractional` 0.5. Net premium is −R$2.00/unit (a debit), but the
put's assignment at S = 0 makes the per-unit max loss R$30.00 (strike 28 plus the R$2.00 debit).
`resolveSizingUnits` (`price-operation.ts`) divided the R$5,000 budget by R$2.00, sizing 2,500
units for a total max loss of R$75,000 — 7.5× the declared capital. `enforce` mode's
`maxLossPerOperation` risk limit refuses the fill, so the unsound size never reaches a real
position, but `warn` mode fills it, and the sizing figure itself is wrong before any limit runs.

## Decision

`resolveSizingUnits`'s net-debit branch reuses the same reading the non-debit branch and
`fixed_risk` already give: size on the larger of the premium paid and the structure's bounded max
loss per unit, and refuse with `unsizeable(unbounded_max_loss)` when the max loss is unbounded (a
net debit with a short leg whose payoff is unbounded on the side the short leg is naked, e.g. a
long call under two short calls at a higher strike). No parallel helper: the branch keeps calling
the existing `unitsFromPerUnit`, now with `Decimal.max(maxLoss, netPremium.abs())` as its
argument, and reads `computePayoffProfile`'s `maxLoss` that the branch already computes for the
risk-limit check just below it.

A pure debit structure (no short leg, e.g. a single long call or a long vertical spread) has max
loss exactly equal to the premium paid, so `Decimal.max` is a no-op for it: sizing is unchanged,
proven by a test asserting the same unit count the premium-only divisor gave before this change.

## Consequences

- `fixed_fractional` never sizes a bounded net-debit structure with a short leg past its declared
  budget: units × per-unit max loss ≤ capital × fraction, proven as a `fast-check` property over
  randomized strikes, premiums and fractions.
- The verified case above now sizes `floor(R$5,000 / R$30.00) = 166` units (max loss R$4,980,
  under the R$5,000 budget), not 2,500 units.
- `ENGINE_VERSION` is not bumped. Per the change policy in ADR-0013 ("a bump tracks a checkpoint-
  or persistence-breaking shape change, never additivity by itself"; #54's addendum sets the
  precedent for a value-only fix), this change alters the _value_ `resolveSizingUnits` returns for
  a net-debit structure with a short leg, not the shape of any checkpointed or persisted artifact:
  `SimulatedOperation`, `BacktestCheckpoint` and every other frozen type are untouched. No fixture
  in the repo exercises `fixed_fractional` on a net-debit structure with a short leg (the existing
  golden and property fixtures cover non-debit and pure-debit sizing only), so no golden or
  checkpoint fixture's numbers change; a backtest resumed from a pre-#131 checkpoint that later
  sizes such a structure gets the corrected, smaller size going forward, which is the intended
  fix, not a compatibility break.
- A strategy backtested before this change with a net-debit structure carrying a short leg under
  `fixed_fractional` may report a smaller position size, and therefore different P&L, on a re-run:
  expected, since the prior size understated the capital at risk.
