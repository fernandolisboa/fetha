---
status: accepted
date: 2026-09-02
---

# Numeric representation: decimal prices, integer centavos, no floats for money

Prices, greeks, volatilities and percentages are arbitrary-precision decimals (`decimal.js` in
code, `numeric` in Postgres): B3 prices at scale 2, greeks, implied volatility and percentages
at scale 6 (displayed at 4). Money (P&L, costs, capital, premiums paid) is an integer number of
centavos with currency `BRL`. Quantities are integers of shares or option units. JavaScript
`number` is never used for money or prices, so that sums, fees and taxes are exact and
reproducible across the engine, the database and the UI.

## Considered options

- IEEE floats everywhere: simplest, but rounding drift in P&L and tax computations is
  unacceptable for a tool whose whole point is numeric honesty.
- Integer centavos for prices too: exact, but greeks and volatilities are not money and need
  more scale; one decimal type for all non-money quantities keeps the engine uniform.
