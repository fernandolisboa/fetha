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
  itself. Each leg's P&L is taken against its premium in that pricing (`premiumPerUnit`: the
  leg's given price when it carries one, which is the user's entry in the builder; else its
  market price; else its fair value), exactly as the expiry curve does; legs are summed as
  `Decimal` and rounded once to integer centavos.
- **Samples.** Every underlying the expiry curve samples (so the two curves can be read at the
  same points), plus a grid one percent of spot apart over 0.8x to 1.2x of spot that runs on, in
  whole percents of spot, to the lowest and highest of those samples, rounded to `PRICE_SCALE`,
  de-duplicated and sorted ascending. A chart joins them with straight segments, so a strike or
  break-even far from spot never leaves a long chord standing in for the curve (a long put struck
  at 0.65x spot read +R$ 2.08 per unit at 0.725x on a chord from its strike to 0.8x, where the
  model gives +R$ 1.47). Past the 0.8x–1.2x core the step widens only as much as keeps the grid
  within 120 points, which happens only once the stretches below 0.8x and above 1.2x add up to more
  than 79% of spot; the core stays at one percent. A chord over a step `h` misses a convex curve
  by at most `h² Γ / 8`, and a leg's gamma peaks near its strike `K` at about `φ(0) / (K σ √T)`,
  so at `h = 0.01 S` the vertical gap is at most `5·10⁻⁶ S² / (K σ √T)` per unit. For a strike at
  spot with 20% volatility and one session left (`σ √T ≈ 0.0125`) that is `4·10⁻⁴ S` per unit, about
  0.2% of the `0.2 S` a long at-the-money call's expiry P&L spans over the core; a strike at 0.65x
  spot raises it by `S / K`, about half again; it falls as `1 / (σ √T)` with more time or
  volatility (one month at 35%: under `5·10⁻⁵ S`). That is under a pixel on the builder's chart for
  most positions, but not a guarantee: in the last sessions of a low-volatility position the drawn
  kink can sit a few tenths of a percent of the chart's height off the model, and where the step
  has widened the gap grows with its square. Fewer core points (21, a 2% step) quadruple the gap;
  more cost run time and stored bytes for no visible gain.
- **Omission.** `payoffNow` is `null` for an operation with no option leg, where it would repeat
  the expiry line point for point (a legend entry and a "today" read-out for a line hidden under
  it). It is also `null` when any option leg has no model value at `at`: no market
  price to solve a volatility from and no given volatility, a solve that did not converge, or an
  expiry already passed (`markToMarket`'s settlement-pending legs, valued at intrinsic). The curve
  is left out rather than drawn from an invented volatility. `null`, not an empty array, so "no
  curve" is never confused with "a curve with no points".
- **Optional field.** It is optional in the type because pricing persisted before this change
  (`suggestions.pricing`, the research ideas' `pricing` and `signals.proposal` store it as
  `jsonb`) lacks it, and every reader treats an absent field like `null`. `markToMarket` leaves it
  off `OperationValuation.pricing`: there each leg's premium is its current mark, not the user's
  entry, so the curve would read about zero at spot rather than the position's P&L, and nothing
  draws it; skipping it also saves the work on every portfolio read. `evaluateStrategy`'s
  internal exit-rule pricing, which reads only premiums and max loss for every open operation at
  every session, skips it too: computing it there more than doubled a five-year backtest's run
  time (3.3 s to 7.6 s on the `run-backtest` bench). Every other `OperationPricing` the engine
  returns carries it.
- **Version.** Signals' proposals carry `OperationPricing` and are persisted, so this is a shape
  change to a persisted artifact: `ENGINE_VERSION` moves from `0.17.0` to `0.18.0`.

## Consequences

- The payoff chart draws the T+0 curve as a second, thinner (1px) solid `--muted` line under the
  expiry line and reads both values at the pointer when the T+0 curve has a point at the snapped
  underlying (`DESIGN.md`, Charts).
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
