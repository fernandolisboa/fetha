---
status: accepted
date: 2026-10-31
---

# The engine computes a "today" (T+0) payoff curve next to the expiry curve (amends 0013)

## Context

`OperationPricing.payoff` is the operation's P&L at expiry, sampled at 0.8x, 1x and 1.2x of spot,
at every leg's strike and at every break-even. The payoff chart draws only that curve, so a user
looking at a long call one month out sees the hockey stick and nothing of what the position is
worth if the underlying moves today. The value today is a model output (fair value under
Black-Scholes, ADR-0002), and the AI never produces numbers, so the curve has to come from the
engine like every other number on the chart.

## Decision

`OperationPricing` gains `payoffNow?: PayoffPoint[] | null`: the operation's P&L at the pricing
instant (`at`), mark-to-model, over a range of underlying prices.

- **Model.** Each option leg is valued with the same Black-Scholes inputs its own `fairValue` used
  at `at`: its sigma (given, own implied or last-trade implied, whichever priced it), the
  operation's risk-free rate, `q` (0 for every B3 option, ADR-0070), its time to expiry and its
  price factor (ADR-0063). Only the underlying changes, to each sample. A stock leg is the sample
  itself. Each leg's P&L is taken against its entry premium (`premiumPerUnit`), exactly as the
  expiry curve does; legs are summed as `Decimal` and rounded once to integer centavos.
- **Samples.** Every underlying the expiry curve samples (so the two curves can be read at the
  same points), plus 41 points one percent of spot apart from 0.8x to 1.2x of spot, rounded to
  `PRICE_SCALE`, de-duplicated and sorted ascending. A chart joins them with straight segments. A
  chord over a step `h` misses a convex curve by at most `h² Γ / 8`, and Black-Scholes gamma peaks
  at `φ(0) / (S σ √T)`, so at `h = 0.01 S` the gap is at most `5·10⁻⁶ S / (σ √T)` per unit. That is
  under 0.1% of the 0.4 S range the chart spans whenever `σ √T ≥ 0.0125` (20% volatility with one
  session left), below one pixel on any chart the app draws. Fewer points (21, a 2% step) quadruple
  the gap, enough to show a kink near expiry; more points cost run time and stored bytes for no
  visible gain.
- **Omission.** `payoffNow` is `null` when any option leg has no model value at `at`: no market
  price to solve a volatility from and no given volatility, a solve that did not converge, or an
  expiry already passed (`markToMarket`'s settlement-pending legs, valued at intrinsic). The curve
  is left out rather than drawn from an invented volatility. `null`, not an empty array, so "no
  curve" is never confused with "a curve with no points".
- **Optional field.** The engine sets it on every `OperationPricing` that leaves the package.
  It is optional in the type because pricing persisted before this change (`suggestions.pricing`,
  the research ideas' `pricing` and `signals.proposal` store it as `jsonb`) lacks it, and every reader treats an
  absent field like `null`. `evaluateStrategy`'s internal exit-rule pricing, which reads only
  premiums and max loss for every open operation at every session, skips it: computing it there
  more than doubled a five-year backtest's run time (3.3 s to 7.6 s on the `run-backtest` bench).
- **Version.** Signals' proposals carry `OperationPricing` and are persisted, so this is a shape
  change to a persisted artifact: `ENGINE_VERSION` moves from `0.17.0` to `0.18.0`.

## Consequences

- The payoff chart draws the T+0 curve as a second, dashed line and reads both values at the
  pointer when the T+0 curve has a point at the snapped underlying (`DESIGN.md`, Charts).
- `payoff`, `breakEvens`, `maxLoss` and `maxGain` are unchanged: break-evens and extremes stay
  defined at expiry.
- The AI fact sheet (ADR-0057) does not read `payoffNow`; adding it is a separate decision.
- A put's T+0 value can sit below its expiry payoff deep in the money when `r > 0` (a European put
  is worth at least `K e^(-rT) - S`, not `K - S`), so the T+0 curve can cross under the expiry
  curve on the put side. That is the model, not a bug.

## Alternatives considered

- **Have the web app compute the curve from `LegValuation`.** It would need the engine's pricing
  model outside the engine and break ADR-0006/0013. Rejected.
- **An empty array when the curve cannot be computed.** Ambiguous with a degenerate curve; the
  chart would need to tell the two apart. Rejected for `null`.
- **Extra samples on the expiry curve too.** The expiry curve is piecewise linear between its
  strikes, so its current samples are exact; adding points changes stored artifacts and the AI
  fact sheet for nothing.
