---
status: accepted
date: 2026-09-02
---

# Option pricing: Black-Scholes-Merton with continuous dividend yield, European for all series

Fair value, implied volatility and greeks use Black-Scholes-Merton with a continuous dividend
yield per underlying, the CDI/Selic curve as risk-free rate and analytic greeks. B3 stock calls
are American and puts are European; we price both as European in v1 because early exercise of
a call is only rational just before a dividend and the value gap is small for the liquid,
short-dated series Fetha targets. The approximation is documented per analysis (the engine
reports the model used). A binomial (CRR) model for American exercise is an extension behind
the same pricing interface, not a rewrite.

## Considered options

- Binomial CRR from day one: exact for American calls but slower, harder to test by property,
  and unnecessary for the first structures (collar, trava de alta).
- Black-Scholes without dividends: simpler but wrong for Brazilian large caps with high yields.
