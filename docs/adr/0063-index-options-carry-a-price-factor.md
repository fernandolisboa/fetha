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
    and `mark-to-market.ts`) and a payoff P&L/max-loss/max-gain (`price-operation.ts`'s
    `payoffAt`, carrying the factor per leg on `PricedLeg`) are divided by `priceFactor` before
    they become a reais-denominated output. A market premium read straight from storage (an
    `average`/`close` fill reference, ADR-0011's `fill-pricing.ts`; a mark read from a stored
    price) needs no conversion: it is already reais.
  - Every money-valued greek but delta follows the same division: gamma, theta, vega and rho are
    all homogeneous of degree one in (spot, strike) jointly, the same degree as fair value itself
    (gamma is technically degree -1 in spot alone, but the division here is a pure output-unit
    rescaling, not a re-differentiation, so the same `/priceFactor` applies uniformly to every
    model output). Delta (`∂V/∂S`) is kept as the model's own unit-free ratio in the series'
    quotation unit, unconverted: it is a hedge/selection ratio, not a money figure, and
    delta-target strike selection (`resolve-leg-selection.ts`) depends on comparing it the same
    way for every series regardless of `priceFactor` — pinned by a test that a deep-in-the-money
    index-option series is still correctly selected over a far out-of-the-money one.
- No `ENGINE_VERSION` bump (ADR-0040's own precedent): `priceFactor` is an optional field that
  defaults to the pre-existing behaviour, absent from every checkpoint and config stored before
  this change, and every existing fixture and golden file is unaffected bit-for-bit.
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

- `apps/web` must populate `OptionSeries.priceFactor` from the instruments registry's `PricFctr`
  when it starts ingesting IBOV11 and its option chain; absent that, every index option continues
  to default to factor 1 and fails its own IV solve the same way it does today (a known, now-named
  gap, not a silent wrong number).
- Every existing equity-option fixture, checkpoint and golden file is untouched: `priceFactor`
  absent is bit-identical to today's behaviour by construction.
- A future second index product (if B3 ever quotes one with a different points-per-real ratio)
  needs only its own `priceFactor`, no engine change.
