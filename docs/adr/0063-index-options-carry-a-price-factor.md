---
status: accepted
date: 2026-10-13
---

# Index options carry a price factor; premiums are reais per contract, strikes and spot stay in points (#307, amends 0013; notes 0040)

## Context

B3 quotes Ibovespa options in index points, with one contract worth R$ 0,01 per point (lot = 1
contract; `https://www.b3.com.br/pt_br/produtos-e-servicos/negociacao/renda-variavel/opcoes-sobre-ibovespa.htm`).
ADR-0017 already found the consequence on the ingestion side: the instruments registry's
`PricFctr` (100 for Ibovespa series) and COTAHIST's own `FATCOT` (also 100 for the same series)
both divide a raw premium field down to reais per contract before it is stored (`option_daily_prices`),
while `PREEXE` (strike) divides by 100 alone and stays in raw index points — "strike in raw
points, prices in R$ per contract already divided by `FATCOT`", per ADR-0017's own COTAHIST
section. `option_series.strike` (ADR-0017) inherits the same point-in-time rule ADR-0056 gives
every other strike. So the stored premium (e.g. IBOVA183's real `PREULT` 19 305 points -> stored
close 193.05) and the stored strike/spot (183 000, 180 000) already live on two different scales
before the engine ever sees them. An implied-volatility solve or a fair-value comparison that
reads both at face value is off by the registry's own factor — 100x for Ibovespa options — which
would fail every solve the moment IBOV11 gets a candle and the nightly `iv_index` job runs on it.

## Decision

- `OptionSeries` gains an optional `priceFactor: DecimalString`. Absent means 1, the pre-existing
  behaviour for every equity option (which B3 quotes and prices in reais directly). Present, it
  is the series' own quotation unit (index points) per real of premium as stored — B3's registry
  `PricFctr`.
- Spot, strike, break-evens and the payoff x-axis stay in the series' quotation unit throughout
  the engine (points, for an index option); `priceFactor` converts only at the two seams where a
  premium or a model value meets them:
  - a market premium (already reais, as stored) is multiplied by `priceFactor` before it reaches
    an implied-volatility solve, so the solve compares like with like against spot/strike in
    points (`option-pricing.ts`'s `priceOptionLeg`, `implied-volatility-index.ts`'s ATM bracket
    solves, and delta-target strike selection's own IV read in `resolve-leg-selection.ts`);
  - a model fair value, an intrinsic value (an expired leg's basis in `price-operation.ts`, a
    settlement's intrinsic in `propose-settlement.ts`'s `settleLeg`, read unchanged by `score.ts`
    and `mark-to-market.ts`), a payoff P&L/max-loss/max-gain (`price-operation.ts`'s `payoffAt`,
    carrying the factor per leg on `PricedLeg`) and the payoff's own slope at infinity (the same
    `payoffAt` module's `legIntrinsicSlopeAtInfinity`, which the break-even/max-loss/max-gain
    extrapolation for an unbounded leg reads instead of a sampled point) are divided by
    `priceFactor` before they become a reais-denominated output. A market premium read straight
    from storage (an `average`/`close` fill reference, ADR-0011's `fill-pricing.ts`; a mark read
    from a stored price) needs no conversion: it is already reais.
  - Delta and gamma are both derivatives with respect to the underlying, so both stay unconverted,
    in the series' own quotation unit: delta (`∂V/∂S`) is homogeneous of degree 0 in (S, K) and
    already unit-free; gamma (`∂²V/∂S²`) is homogeneous of degree -1, not +1 like fair value
    (dividing it by `priceFactor` as if it were a money greek — round 1 of this ticket's own
    review — silently rounds an index option's already-small gamma to zero at the reported
    scale). Neither is a money figure: both are hedge/selection ratios, and delta-target strike
    selection (`resolve-leg-selection.ts`) depends on comparing delta the same way for every
    series regardless of `priceFactor` — pinned by a test that a deep-in-the-money index-option
    series is still correctly selected over a far out-of-the-money one. Theta, vega and rho stay
    money greeks, homogeneous of degree one in (spot, strike) jointly like fair value itself, so
    they are divided by `priceFactor` the same way fair value is.
  - A portfolio-level aggregate that sums delta or gamma across legs (`mark-to-market.ts`'s
    `totals.greeks`) is therefore only meaningful within one quotation unit at a time: it mixes
    an equity leg's per-share delta with an index-option leg's per-point delta the moment a
    portfolio holds both. An index-option leg's own money exposure per point of the underlying is
    its reported delta divided by its series' `priceFactor`, read off the operation's own leg
    valuation, never off the portfolio aggregate.
  - `OptionSeries` also gains an optional `settlement: "physical" | "cash"`. Absent means
    "physical", the pre-existing behaviour for every equity option: an in-the-money leg settles
    by a fill on the underlying at the strike. B3 cash-settles every index option instead — there
    is no Ibovespa to deliver — so a `"cash"` series' leg never produces that fill, in or out of
    the money; `settleLeg` (`propose-settlement.ts`) instead carries the leg's signed cash flow
    (`intrinsic × quantity`, sign by side) on a new `LegSettlement.cashSettlementValue`, null for
    every physically-settled leg. `runBacktest` books it as option P&L the same way a worthless
    leg's premium already is: never folded into a stock trade, never counted toward
    `currentMonthStockSales` or its R$ 20k exemption, no stock fees. `settlement` is never
    inferred from `priceFactor` — a priceFactor is only a quotation-unit conversion, settlement is
    the registry's own, separate fact (B3's `TpMerc`/instrument category) — so `apps/web` fills it
    independently from the registry when it starts ingesting an index option's chain (the same
    follow-up `priceFactor` itself is waiting on, below). Index options never reach a backtest
    through the web today (they are excluded from universes before that), but the engine is
    correct for the day they are not.
- No `ENGINE_VERSION` bump (ADR-0040's own precedent): `priceFactor`, `settlement` and
  `LegSettlement.cashSettlementValue` are all optional/nullable fields that default to the
  pre-existing behaviour, absent (or null) from every checkpoint and config stored before this
  change, and every existing fixture and golden file is unaffected bit-for-bit.
- ADR-0040's `b3OptionFeeRate` is the equity-option tariff (B3's "Opções de Ações" page); B3's own
  index-option tariff is a separate schedule this ADR does not model. `fillCosts` keeps charging
  `b3OptionFeeRate` (or `b3FeeRate`, absent that) on every option fill regardless of
  `priceFactor`; a dedicated index-option fee rate is a follow-up, not made here.
- **Rejected: store the index level and index strikes already divided by `priceFactor`.** This
  would keep every number the engine touches on one scale, but at a real cost: `option_series.strike`
  (ADR-0017) and its point-in-time history (ADR-0056) would need every stored epoch rewritten by
  the same factor, reversing ADR-0017's own rule that `PREEXE`/`ExrcPric` are kept in raw points
  unscaled; and every stored number — the index level, every strike, every chart axis — would
  read 1/100 of what B3 itself calls the Ibovespa and its listed strikes, a permanent mismatch
  against B3's own published numbers, provider payloads and the owner's own mental model of the
  index. Converting only at the premium/model-value seam keeps every stored and displayed number
  exactly what B3 calls it.

## Consequences

- `apps/web` must populate `OptionSeries.priceFactor` and `OptionSeries.settlement` ("cash" for
  registry category OPTION ON INDEX) from the instruments registry when it starts ingesting
  IBOV11 and its option chain; absent that, every index option continues to default to factor 1
  and physical settlement and fails its own IV solve the same way it does today (a known,
  now-named gap, not a silent wrong number).
- Every existing equity-option fixture, checkpoint and golden file is untouched: `priceFactor`
  absent is bit-identical to today's behaviour by construction.
- A future second index product (if B3 ever quotes one with a different points-per-real ratio)
  needs only its own `priceFactor`, no engine change.
