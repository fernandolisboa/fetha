---
status: accepted
date: 2026-09-27
---

# B3 fees charged by instrument class: an option-premium rate beside the cash-equity rate (amends 0004, 0013)

## Context

ADR-0013 "Fills" charged one `b3FeeRate` on the gross traded value of every fill, stock and option
alike, and called it "the accepted v1 simplification of B3's per-instrument fee table". The web
preset set that rate to 0,05%, citing B3's "Tarifa de Negociação" (#89). Neither held up against
B3's own tariff pages, read on 2026-09-27 for a retail investor (pessoa física), non-day-trade,
charged per side:

| market          | page                                                       | rows                                                     | total                       |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------- | --------------------------- |
| shares          | "Ações à vista", ADTV mensal up to R$ 3 milhões            | Negociação 0,00500%, CCP 0,02240%, TTA 0,0026%           | 0,0300% of the traded value |
| option premiums | "Opções de Ações", "Pessoas físicas e demais investidores" | Negociação 0,0370%, Liquidação 0,0275%, Registro 0,0695% | 0,1340% of the premium      |

Sources: `https://www.b3.com.br/pt_br/produtos-e-servicos/tarifas/listados-a-vista-e-derivativos/renda-variavel/tarifas-de-acoes-e-fundos-de-investimento/a-vista/`
and `.../opcoes-de-acoes/`. The pages state that PIS, COFINS and ISS are already inside those
rates, and that an option exercise "é cobrado de acordo com as tarifas descritas em Ações à vista".
Neither page shows an effective date. Custódia is a monthly charge on the held balance, not a
per-trade rate.

So the preset overstated the share fee by 1,67×, and a single rate cannot be right for both
markets: the option-premium rate is 4,47× the share rate. With the share rate on option fills the
engine would understate option fees; with the option rate on share fills it would overstate share
fees by the same factor.

## Decision

- `CostModel` gains an optional `b3OptionFeeRate`, the B3 fee on an option fill's gross premium.
  `b3FeeRate` stays the fee on a stock fill, which includes the stock delivered or received at an
  option's expiry or exercise (the B3 rule above).
- `fillCosts` charges `b3OptionFeeRate` on an option fill when the cost model carries it, and
  `b3FeeRate` otherwise. The field is optional so every cost model stored before this ADR (in
  `backtest_runs.cost_model`, `backtest_runs.result.config.costModel` and `decisions.cost_model`)
  still parses and replays exactly as it ran: those models charged `b3FeeRate` on option fills,
  and an absent `b3OptionFeeRate` keeps doing so. No data migration, and an absent key leaves the
  config digest unchanged (`JSON.stringify` drops it), so an in-flight run resumes.
- The web presets carry `b3FeeRate: 0.0003` and `b3OptionFeeRate: 0.00134`, with the rows above
  cited beside them. Day-trade tables, the lower ADTV tiers and custódia are not modeled.
- No `ENGINE_VERSION` bump: ADR-0013's change policy ties a bump to checkpoint-breaking shape
  changes, and an optional field that an old checkpoint's config never carries breaks none.

## Consequences

- New backtests and decisions report lower share fees and higher option fees than before; runs
  already stored keep their own numbers.
- A future B3 tariff change is a preset edit plus a line in this ADR's table, not an engine change.
- If the owner's broker passes B3 fees through differently, a preset is still the only knob; a
  per-user editable cost model remains out of scope.
