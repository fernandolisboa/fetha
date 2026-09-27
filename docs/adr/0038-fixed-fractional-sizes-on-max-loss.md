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

A structure with no short leg (a single long option, a long vertical, a married put, a long guts
strangle) has max loss ≤ premium paid, never more: every leg is owned outright, so the worst case
is every leg expiring worthless, which is exactly the premium paid, or less when one leg's
intrinsic value offsets another's (a married put's protective put caps the loss well under the
combined premium). `Decimal.max` therefore always resolves to the premium for these structures,
leaving their sizing unchanged, proven by tests pinning the same unit count the premium-only
divisor gave before this change.

## Consequences

- `fixed_fractional` never sizes a bounded net-debit structure past its declared budget: units ×
  per-unit max loss ≤ capital × fraction, proven as a `fast-check` property over randomized
  strikes, premiums and fractions on a short-put/long-call structure (always bounded by
  construction). This bound is pre-cost: it sizes off `computePayoffProfile`'s max loss, before
  the fees, B3 taxes and slippage `runBacktest`/fill pricing apply at the actual fill, the same as
  every other `fixed_fractional`/`fixed_risk` divisor. It also carries the same sub-centavo
  rounding slack `fixed_risk` already has: the divisor is `maxLoss`, itself rounded to centavos by
  `computePayoffProfile`, not the unrounded decimal max loss, so the bound can be off by a
  fraction of a centavo per unit at the edge, never more.
- The verified case above now sizes `floor(R$5,000 / R$30.00) = 166` units (max loss R$4,980,
  under the R$5,000 budget), not 2,500 units.
- A bounded net-debit structure with a short leg that used to size under the premium-only divisor
  can now be `unsizeable(unaffordable_budget)` when the corrected, larger divisor no longer fits
  the same budget (e.g. the same short put 28 / long call 32 structure at R$100 capital and 0.1
  fraction: R$10 budget affords 5 units on the R$2.00 premium but zero units on the R$30.00 bounded
  max loss). This is the fix working as intended, not a regression: the prior size understated the
  capital actually at risk.
- `ENGINE_VERSION` is not bumped. Per the change policy in ADR-0013 ("a bump tracks a checkpoint-
  or persistence-breaking shape change, never additivity by itself"; #54's addendum sets the
  precedent for a value-only fix), this change alters the _value_ `resolveSizingUnits` returns for
  a net-debit structure with a short leg, not the shape of any checkpointed or persisted artifact:
  `SimulatedOperation`, `BacktestCheckpoint` and every other frozen type are untouched. The
  `run-backtest-settlement.golden.test.ts` fixtures do include net-debit structures with a short
  leg under `fixed_fractional` (the covered call, the collar and both bull-call-spread cases all
  carry a short call), but every one of them has max loss ≤ premium paid already (a covered call's
  max loss is the stock cost net of the call premium received, a collar's downside is capped by
  its long put, a debit vertical's max loss is the premium by construction), so `Decimal.max`
  resolves to the same premium divisor for all four and none of their golden numbers change.
  Consequence for checkpoint validity: `resume.engineVersion` equal to `ENGINE_VERSION` no longer
  implies equal sizing for this structure class specifically. A chunked backtest run resumed
  across a deploy that carries this fix sizes any net-debit-with-a-short-leg entry it opens after
  the resume on the corrected divisor while entries already opened before the resume keep the size
  they were filled at — the same mix any other value-only, non-bumped fix already produces for
  operations opened on either side of the deploy, not a new class of inconsistency this ADR
  introduces.
- A strategy backtested before this change with a net-debit structure carrying a short leg whose
  max loss exceeds its premium may report a smaller position size, and therefore different P&L, on
  a re-run: expected, since the prior size understated the capital at risk.
