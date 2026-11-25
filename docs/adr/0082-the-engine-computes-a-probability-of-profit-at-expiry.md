---
status: accepted
date: 2026-11-21
---

# The engine computes a probability of profit at expiry for a priced operation (amends 0013, 0067)

## Context

The suggestion card (ADR-0067, 2026-11-21 amendments) shows three figures: Arrisca / Ganha até /
Ganho ÷ risco (`PayoffFigures`, `apps/web/src/modules/radar/components/lot-parts.tsx`). Its grid
has a fourth slot, kept empty for now. The owner, who is new to options, asked for a fourth
figure there: "Chance de lucro". It is a number, so the engine has to compute it (CLAUDE.md
principle 1). The web app may not compute it from `OperationPricing`, because that would move
pricing math out of the engine (ADR-0006, ADR-0013).

Everything the figure needs is already inside `priceOperation`:

- the expiry payoff (`computePayoffProfile`, `internal/price-operation.ts`), piecewise linear,
  with kinks at 0 and at every strike;
- its break-evens: every sign change, plus both ends of every zero plateau, rounded to
  `PRICE_SCALE` and de-duplicated;
- the risk-free rate `r = ln(1 + cdi)` and `q` (0 for every B3 option, ADR-0070);
- each option leg's `OptionLegModel` (`sigma` and `timeToExpiryYears`, the same pair its fair
  value and the T+0 curve use, ADR-0077).

ADR-0067 turned down "a likelihood for each suggestion" because no engine fact supported one for
a single match. This figure is that engine fact: a model output for this lot, with its inputs
reported. It does not change the suggestion's claim, its asserted confidence of `1`, or how the
suggestion is scored.

## Decision

`OperationPricing` gains `probabilityOfProfit?: ProbabilityOfProfit | null`. It is the
model-implied probability that the operation's expiry payoff is strictly positive.

### Model: lognormal terminal price, risk-neutral drift

The underlying's price at expiry is lognormal with the risk-neutral drift used everywhere else in
the engine (Hull, _Options, Futures, and Other Derivatives_, ch. 15: the lognormal property, and
`N(d2)` as the probability of exercise in a risk-neutral world):

```
F(x) = P(S_T <= x) = N( (ln(x / S) - (r - q - σ²/2) T) / (σ √T) ),   F(0) = 0,  F(+∞) = 1
```

`S` is `OperationPricing.spot`, `r` is `riskFreeRate` and `q` is `dividendYield`. `T` and `σ`
are defined below. `N` is the engine's existing standard normal CDF (`black-scholes.ts`,
Abramowitz & Stegun 7.1.26, error below 1.5·10⁻⁷). That error is negligible at the four decimal
places reported here. The math runs on doubles behind the same number-to-Decimal seam as
`bsmPriceRaw`.

Why risk-neutral and not a real-world drift:

- **Every input already exists in the engine.** `r` comes from the CDI, and `σ` comes from the
  operation's own legs, under the same measure that priced their fair values and IVs. The figure
  is therefore consistent with the premiums and break-evens printed next to it.
- **The real-world drift `μ` cannot be observed.** Estimating it, for example from past returns,
  gives a noisy number that amounts to a forecast. The figure must never claim to be a forecast.
- **Zero drift (`μ = 0`) is no more neutral.** It is just as arbitrary an assumption, and it
  contradicts the forward price the options are priced from. With the CDI near 15%, the two
  log-means differ by `rT`, about 1.2% of spot per month. That moves a near-the-money figure by a
  few percentage points.

The figure is a property of the pricing model, not a forecast. If investors earn a risk premium
(`μ > r`), the risk-neutral probability understates the chance of an up move, so it leans
slightly against bullish structures. The card says so in plain words (UI consequence below).

Note that a long call's probability of profit is not the `N(d2)` of its strike. It is
`N(d2)` with the break-even `K + premium` in place of `K`: `N(d2)` at `K` is the probability of
finishing in the money, not of finishing in profit. The two coincide only for a structure whose
break-even is the strike itself (test 5 below).

### Volatility: the leg nearest the money, one σ for the whole distribution

- **Rule.** Take the option legs that have a model (`PricedLeg.model !== null`). Among them, keep
  those whose strike is nearest to spot (`|strike − spot|`, both on the series' quotation unit).
  `σ` is the arithmetic mean of those legs' `model.sigma`. When there is a tie, all tied legs
  count: a straddle's call and put, or two strikes equidistant from spot (an iron condor's short
  strikes centred on spot). The mean does not depend on leg order, so permuting the legs leaves
  the figure unchanged.
- **Fallback chain.** A leg with no model is skipped: one with no price and no given volatility,
  `iv_not_converged`, `below_intrinsic`, or an IV solve suppressed across a corporate action.
  The next-nearest leg with a model is used instead. When no option leg has a model, the result
  is `null`. There is no further fallback. In particular the IV index (ADR-0054) is not used: it
  is a 30-calendar-day constant-maturity point, not the operation's expiry, and it is not loaded
  into every pricing view.
- **Why one σ.** A single σ keeps `F` a proper CDF, so `P` stays in `[0, 1]` and an operation's
  probability and its mirror's add up to exactly 1. Splicing a different σ at each break-even
  (the "leg nearest each break-even" candidate) can make `F` non-monotone, and then `P` can fall
  outside `[0, 1]`. A vega-weighted mean of the legs' IVs needs a weighting convention for legs
  of opposite sign. It also lands near the at-the-money IV anyway, because vega peaks at the
  money.
- **Known limitation.** One σ ignores the smile. For wide structures (strangles, condors) the
  wings trade at higher IVs than the at-the-money σ, so the market puts more mass in the tails
  than this model does. A short condor's figure therefore reads somewhat optimistic next to a
  smile-consistent (digital-option) probability. That is acceptable for a decision-support
  figure labelled "pelo modelo". It is not acceptable for anything that sizes or ranks.
- **`T`** is the shared `model.timeToExpiryYears` of the option legs, the same clock as their
  fair values (ADR-0013 "Rates, time and greeks").

### Profit region

Let `b₁ < … < bₙ` be the operation's own `breakEvens`, as reported. Add `b₀ = 0` and
`bₙ₊₁ = +∞`. The payoff keeps one sign on each open interval `(bᵢ, bᵢ₊₁)`, because every
crossing and every plateau edge is a break-even. Then:

```
P = Σ over intervals where payoffAt(m_i) > 0 of [ F(b_{i+1}) − F(b_i) ]
```

`m_i` is the interval's sign probe, evaluated with `payoffAt` on the priced legs, never read from
the rounded samples:

- the midpoint `(bᵢ + bᵢ₊₁) / 2` for a bounded interval, which gives `b₁ / 2` for `(0, b₁)`;
- `2·bₙ + 1` for the upper tail `(bₙ, +∞)`. The payoff is linear beyond the last kink and has no
  further crossing, so any point above `bₙ` reads the tail's sign; `+ 1` covers `bₙ = 0`.

The sum is clamped to `[0, 1]` to absorb double rounding, then rounded half-up to 4 decimal
places.

The cases:

- **Unbounded tails.** These are `F(+∞) = 1` and `F(0) = 0`. A long call's profit region is
  `(b₁, +∞)`, so `P = 1 − F(b₁)`.
- **A zero plateau** (a vertical spread bought at exactly its width, the flat top of a payoff
  that is exactly zero) has a probe value of `0`. That is not `> 0`, so the plateau counts as no
  profit. "Lucro" means strictly positive.
- **No break-evens.** The payoff has one sign on `(0, +∞)`, or is identically zero. `P` is
  `"1.0000"` when `payoffAt(spot) > 0` and `"0.0000"` otherwise. This needs no special case
  beyond the probe at spot.
- **Stock legs** are already in `payoffAt` and the break-evens (a covered call is a stock leg
  plus a short call). They contribute no σ: an operation with no option leg is `null`.
- **Multiple expiries.** `priceOperation` already refuses option legs with different expiries
  (`validateConcreteLegs`, `invalid_input`), so calendars and diagonals never reach this
  function today. The function still returns `null` when the option legs' `timeToExpiryYears`
  differ. That one guard means a later ticket that admits calendars cannot silently integrate
  over the wrong terminal date. One terminal date is a precondition of the figure.
- **`T = 0`** (the pricing instant is the expiry session's close) returns `null`. There is no
  distribution left to integrate, and the card already shows the payoff at spot.
- **Short `T` and spot at a break-even need no special case.** As `T → 0⁺` with `σ√T > 0`,
  `F(bᵢ) → 1{spot ≥ bᵢ}`, except at `bᵢ = spot`, where `F → 1/2`. A one-session long call
  with spot exactly at its break-even reads about 0.51 (test 13), which is correct.
- **Premiums are real.** If any leg has neither a `price` nor a `fairValue`, its premium
  defaulted to zero (`valueOneLeg`). The payoff and break-evens then describe a different
  operation, so the result is `null`.

Using the reported break-evens rather than the unrounded crossings makes `P` exactly the
probability of the underlying finishing in the zone the card prints ("se VALE3 fechar entre
R$ 14,25 e R$ 16,80"). Each break-even is off by at most half a cent, so the gap to the exact
crossing is at most `f(bᵢ) · 0.005` per break-even, where `f` is the lognormal density. For a
one-month position at 30% σ on a R$ 30 stock, that is under 0.001. The figure is before costs
and taxes, like the break-evens. It assumes the lot is held to expiry under European exercise
(ADR-0002), so early assignment of a short American call is not modelled.

### Interface

ADR-0013's change policy allows a new field on an artifact without a superseding ADR. A
separate exported function, or a new `Engine` method, would need one, and it would also force
callers to re-pass the inputs `priceOperation` already resolved. So the figure is a field.
`packages/engine/src/api.ts` gains, verbatim:

```ts
export type ProbabilityOfProfit = {
  probability: DecimalString;
  volatility: DecimalString;
  volatilityFrom: Ticker[];
};
```

and, on `OperationPricing`, right after `breakEvens`:

```ts
  // ADR-0082: model-implied P(expiry payoff > 0), lognormal with the risk-neutral drift and the
  // sigma of the option leg(s) nearest spot; null with no option leg, no leg sigma, T = 0, legs
  // on different expiries or a leg with no premium. Absent from `markToMarket`'s pricing and
  // from pricing stored before 0.21.0.
  probabilityOfProfit?: ProbabilityOfProfit | null;
```

- `probability` is in `[0, 1]` at a new `PROBABILITY_SCALE = 4` (`internal/decimal.ts`), for
  example `"0.3588"`. Four places is the precision the inputs support: break-evens rounded to
  the cent move the fourth place. It amends ADR-0013 invariant I5's scale list (prices 2;
  greeks, volatilities and ratios 6; probabilities 4).
- `volatility` is the σ used, at `RATIO_SCALE`. `volatilityFrom` lists the tickers of the legs
  it was read from, de-duplicated and sorted ascending. Each one's `volatilitySource` is already
  on its `LegValuation`. With `spot`, `riskFreeRate`, `dividendYield`, `breakEvens` and the legs'
  `timeToExpiryYears`, every input is on the artifact, so an AI fact sheet that later reads the
  figure can cite all of it.
- No new `NoteCode`. `null` means unavailable, and the reasons are listed in the comment above,
  as with `payoffNow`. `null`, not an absent field, is what a 0.21.0 pricing returns when the
  figure is unavailable. An absent field means the pricing predates 0.21.0, or comes from
  `markToMarket`.
- **Where it is computed.** It is computed and omitted exactly where `payoffNow` is
  (ADR-0077), in `priceConcreteLegs`, under the same option. `markToMarket` leaves it off,
  because its premiums are marks, not entries. `evaluateStrategy`'s internal exit-rule pricing
  skips it. Signals' proposals, `priceOperation` and the radar's and research's pricings carry
  it. The implementation is a new `internal/probability-of-profit.ts` exporting one function
  over `(priced legs, spot, breakEvens, riskFreeRate, dividendYield)`.
- **Version.** `suggestions.pricing`, the research ideas' `pricing` and `signals.proposal`
  persist `OperationPricing` as `jsonb`, so this is a shape change to a persisted artifact.
  `ENGINE_VERSION` moves from `"0.20.0"` to `"0.21.0"`. The backtest goldens change only by the
  version and, in `catch-up-evaluation.json`, by `probabilityOfProfit: null` on each stock-only
  proposal.
- **Same PR as the implementation.** The implementer adds the two `api.ts` blocks to
  ADR-0013's frozen block byte for byte (`scripts/check-adr-0013-frozen-block.sh`), plus an
  ADR-0013 addendum pointing here. They also add a **Probability of profit** glossary entry
  (_Avoid_: win rate, chance of winning, "probabilidade de acerto" in code; pt-BR label "Chance
  de lucro") and add the figure to `CONTEXT.md`'s list of what `priceOperation` produces.

### UI consequence

- **Card A.** `PayoffFigures` takes an optional `probabilityOfProfit: DecimalString | null`.
  When it is a string, the fourth `Figure` renders: label "Chance de lucro", the value as a
  whole percent, and the hint "Pelo modelo de preços, no vencimento. Não é previsão." (final
  wording after the `/better-portuguese` pass). The value uses neutral ink, never `--up` or the
  risk colour: it is neither a gain nor a risk. When the prop is absent or `null`, the slot
  stays empty, with no "—". `SuggestionCard` and `ResearchIdeaCard` both pass
  `pricing.probabilityOfProfit?.probability ?? null`, so the two cards stay in step, which is
  why `PayoffFigures` is shared.
- **Formatting.** This is a pure helper in `apps/web/src/lib/format/`, colocated tests: round
  half-up to a whole percent, pt-BR (`"36%"`). A value below `0.0050` shows `"< 1%"`. A value
  at or above `0.9950` shows `"> 99%"`. A model figure never prints as a certainty.
- **Compact row (card B).** Unchanged in this ticket (open question 1).
- **Stored suggestions and research ideas: no migration, no backfill, no computation on
  read.** An old pricing lacks the field, so its slot stays empty.
  - Computing the figure on read in `apps/web` would put model math outside the engine.
  - Re-pricing on read needs that session's market view, and it would rewrite the artifact the
    suggestion was scored from and the decision snapshot refers to.
  - Nothing is lost by waiting. An open suggestion is replaced as soon as the radar reads a
    newer close (ADR-0073), so "Sugestões de hoje" shows the figure from the first nightly scan
    after deploy. Archived suggestions and past research ideas keep the pricing they were shown
    with, as the record.
- The suggestion's claim, its asserted confidence of `1`, its score and the journal's "Sugestões
  do Fetha" panel are unchanged (ADR-0067 items 3, 4 and 9). The decision snapshot (item 5) does
  not gain the figure. The AI fact sheet (ADR-0057) does not read it. Each of those is a separate
  decision.

### Tests the implementer writes (TDD, before the code)

The shared fixture for tests 1 to 13:

- spot `30.00`;
- a CDI point at `0.15`, so `r = 0.139762`;
- `q = 0`;
- priced at a session close 21 sessions before expiry, so `T = 21/252`;
- every option leg with `volatility: "0.30"` and a given `price`, which decouples σ from the
  premium.

The expected values are `N` of the stated `d2(x) = (ln(30/x) + (r − σ²/2)T) / (σ√T)`, computed
with an exact `erf`. Each sits more than 2·10⁻⁶ from a rounding tie, so the strings are exact
under A&S.

| #   | operation (unit quantity unless noted)                                        | break-evens  | expected `probability`                                    |
| --- | ----------------------------------------------------------------------------- | ------------ | --------------------------------------------------------- |
| 1   | long call 30 @ 1.20                                                           | 31.20        | `N(d2(31.20)) = N(−0.361697) = "0.3588"`                  |
| 2   | long put 30 @ 0.90                                                            | 29.10        | `N(−d2(29.10)) = N(−0.442897) = "0.3289"`                 |
| 3   | short call 30 @ 1.20                                                          | 31.20        | `"0.6412"`; tests 1 + 3 sum to 1 within 0.0001            |
| 4   | bull call spread, buy 30 @ 1.20, sell 33 @ 0.35                               | 30.85        | `N(d2(30.85)) = N(−0.231431) = "0.4085"`                  |
| 5   | zero-cost bull call spread, buy 30 @ 0.50, sell 33 @ 0.50                     | 30.00        | `N(d2(30)) = N(0.091185) = "0.5363"`, the literal `N(d2)` |
| 6   | iron condor: sell 28P @ 0.40, buy 26P @ 0.12, sell 32C @ 0.50, buy 34C @ 0.15 | 27.37, 32.63 | `F(32.63) − F(27.37) = "0.6854"`                          |
| 7   | long straddle, call 30 @ 1.20 + put 30 @ 0.90                                 | 27.90, 32.10 | `1 − (F(32.10) − F(27.90)) = "0.4215"`                    |
| 8   | covered call: stock @ 30.00 + short call 32 @ 0.50                            | 29.50        | `1 − F(29.50) = "0.6123"`, σ from the call                |
| 9   | zero plateau: buy 30 @ 3.20, sell 33 @ 0.20 (debit = width)                   | 33.00        | `"0.0000"`                                                |
| 10  | always profit: buy 30 @ 0.20, sell 33 @ 0.50 (a credit)                       | none         | `"1.0000"`                                                |
| 11  | test 1 with every quantity × 100 (one lot)                                    | 31.20        | `"0.3588"`                                                |
| 12  | stock only                                                                    | —            | `null`                                                    |
| 13  | long call 30 @ 1.20, spot `31.20`, 1 session to expiry                        | 31.20        | `N((r − σ²/2)√T / σ) = N(0.019898) = "0.5079"`            |

Further unit tests:

- **σ rule.** A bull call spread 30/33 with σ 0.25 on the 30 and 0.35 on the 33:
  - at spot 30, `volatility "0.250000"`, `volatilityFrom` = [the 30 call];
  - at spot 31.50, `"0.300000"` and both tickers sorted;
  - on the condor of test 6, both short strikes count.
- **Fallback.** The same spread at spot 31.00, with the 30 call given a price of 0.90 (below
  its 1.00 intrinsic) and no given volatility, so `iv_not_converged`, takes σ from the 33 call:
  `"0.350000"`. A single-option operation whose
  only leg has no model is `null`. A leg with neither price nor fair value makes the result
  `null` even when another leg has a σ.
- **Index options.** An index option with price factor `f` (ADR-0063) gives the same `P` as
  the same strikes and spot priced as a stock option with each premium multiplied by `f`.
- **`null` at `T = 0`** (priced at the expiry session's close). **`null` for mixed `T`**,
  tested through the internal function, since `priceOperation` refuses mixed expiries.
- **Where it appears.** `markToMarket`'s pricing has no `probabilityOfProfit` key, and neither
  does the exit-rule pricing inside `evaluateStrategy`. Signals' proposals and `priceOperation`
  results carry it. `ENGINE_VERSION === "0.21.0"`. The goldens are updated, and the frozen-block
  check is green.

Property tests with `fast-check` (`packages/engine/src/invariants/probability-of-profit.property.test.ts`),
over generated verticals, straddles, strangles, condors and covered calls:

- **Range and form.** Every non-null `probability` is a canonical 4-place `DecimalString` in
  `[0, 1]`.
- **Complement.** For an operation `O` and its mirror `−O` (every side flipped, same prices),
  `P(O) + P(−O) = 1` within 0.0001 when the payoff has no zero plateau, and `≤ 1` always.
- **Credit removes all losses.** A vertical priced at a net credit, so that its payoff is
  positive everywhere, gives `"1.0000"`. A debit at or above the width gives `"0.0000"`.
- **Monotone in the break-even.** For a long call, raising the premium (moving the break-even
  up) never raises `P`. For a long put it never lowers `P`.
- **Invariance.**
  - Multiplying every quantity by `k` leaves `P` unchanged.
  - Multiplying spot, strikes and premiums by the same positive integer leaves `P` unchanged up
    to the cent rounding each break-even already carries (`PRICE_SCALE`): the 4th reported
    decimal, often even the 3rd, is finer than that rounding supports. The card itself only ever
    shows a whole percent, where the gap is never visible.
  - Permuting the legs leaves `P`, `volatility` and `volatilityFrom` unchanged.

UI tests (colocated Vitest):

- **The formatter.** `0.3588 → "36%"`, `0.5 → "50%"`, `0.0049 → "< 1%"`, `0.9950 → "> 99%"`.
- **`PayoffFigures`.** It renders the fourth figure when given a value and nothing when the
  value is absent or `null`.

## Consequences

- The card gains a fourth figure from the first nightly scan after deploy. Suggestions and
  research ideas stored before then show three figures, as now.
- Every pricing from `priceOperation` does a few more `N(·)` evaluations, one per break-even.
  That is negligible next to the IV solves. The backtest's exit-rule pricing skips it, as it
  skips `payoffNow`, so run time is unchanged.
- Fetha now shows a probability next to a suggestion. It comes from the engine, carries its
  inputs, and is labelled as a model output. The AI still produces no number (ADR-0058's
  rejection of an AI-stated probability stands). The suggestion's own track record stays the
  hit rate the journal shows (ADR-0067 item 9).
- The figure could later be checked against outcomes: as the suggestion's asserted confidence,
  its Brier would measure the model's calibration. That would change ADR-0067 item 4, so it is
  left for its own decision.
- If the engine ever prices calendars or diagonals, the figure stays `null` for them until a
  ticket defines a terminal distribution over two dates.

## Alternatives considered

- **Real-world drift from historical returns.** That is a forecast, from a noisy estimate. It
  was rejected above.
- **Zero drift.** Arbitrary, and inconsistent with the forward the legs are priced from.
  Rejected.
- **Smile-consistent probability from digital prices (`−∂C/∂K`)** across listed strikes. It is
  more faithful in the wings, but needs a dense, clean chain and interpolation, and can leave
  `[0, 1]` on noisy closes. It is far more machinery than a fourth figure warrants. Revisit if
  the figure ever sizes, filters or ranks anything.
- **σ per break-even, vega-weighted σ, or the IV index.** Rejected under "Volatility" above.
- **A separate exported function or a new `Engine` method.** It would need a superseding
  ADR-0013 and re-pass inputs `priceOperation` already resolved. Rejected for a field, as
  ADR-0077 did.
- **Computing the figure in `apps/web` from the stored pricing.** That puts model math outside
  the engine (ADR-0006, ADR-0013). Rejected.
- **A backfill migration over stored suggestions.** It rewrites the artifacts that were shown
  and scored, for a panel that refreshes at every close anyway. Rejected.
