# Fetha — Design

Canonical design reference. Filled in Phase 3 after `/design` produces the workstation shell and
the strategy/payoff artboards and the owner picks one. Until then, only the direction below is
binding.

## Direction

A dense, data-first workstation. Dark mode by default. Typography and color tuned for numbers
and charts: tabular figures, tight vertical rhythm, restrained chrome. Hierarchy borrowed from
good trading and analytics layouts; nothing copied.

## Tokens

_Pending Phase 3._

- Color: —
- Type scale: —
- Spacing: —
- Radius: —
- Motion: —

## Chart palette

_Pending Phase 3._ Up/down candles, greeks (delta, gamma, theta, vega), risk bands, equity and
drawdown, distribution.

## Component inventory

_Pending Phase 3._ Interactive primitives come from shadcn/ui and are restyled with the tokens
above; layout, charts (`lightweight-charts`, `visx`) and domain components are custom.

## States

_Pending Phase 3._ Every data view defines loading, empty, error and stale-data states.

## Formatting (pt-BR)

- Currency: `R$ 1.234,56`; negative amounts as `-R$ 1.234,56`.
- Prices: `.` thousands, `,` decimals, two to four decimals depending on the instrument.
- Percentages: `12,5%`. Greeks: four decimals.
- Dates: `02/09/2026`; month labels as `set/2026`.
- Time zone: `America/Sao_Paulo`.
