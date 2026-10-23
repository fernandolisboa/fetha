---
status: accepted
date: 2026-10-23
---

# B3 options are dividend-protected, so the engine prices them with `q = 0` and no dividend source is ingested (#81, amends 0013, 0054)

## Context

The engine prices options with Black-Scholes and a continuous dividend yield `q` (ADR-0013 "Rates,
time and greeks"), read from `MarketView.dividendYields`, and falls back to `q = 0` with a
`dividend_yield_defaulted` note when the collection is empty. No loader has ever filled it, so
every price, implied volatility and greek in the app uses `q = 0`, and the operation builder shows
the note on every option operation as a warning. #81 asked for a dividend yield source to close
that gap. ADR-0054 deferred it as needing a paid per-stock source (brapi's Startup plan,
ADR-0052).

Looking for a free source on 2026-10-23 turned up the fact that settles the question instead. On a
cash distribution's ex-date (dividend, JCP or income), B3 lowers the strike of every listed option
on the underlying by the distribution's amount, rounded to the cent. Checked in COTAHIST
(`PREEXE`, comparing each series' strike on consecutive sessions) for 2024, 2025 and 2026:

- Every distribution moved every series of the underlying by the same amount: VALE R$ 2,74 on
  2024-03-12 (451 series), PETR R$ 1,13 on 2024-04-26 (548), ABEV R$ 0,63 on 2024-12-20, ITUB
  R$ 0,02 every month (its monthly JCP), PETR R$ 0,73 on 2025-04-17 (711), VALE R$ 1,76 on
  2026-08-12 (396), PETR R$ 1,19 on 2026-08-24 (589).
- Splits and bonuses scale strikes instead (BBAS's 2-for-1 on 2024-04-16, ITUB's 10% bonus on
  2025-03-18); ADR-0056 already handles those as strike epochs.

An option whose strike falls by the dividend on the ex-date is **dividend-protected**: the stock
drops by about the dividend and the strike drops by the same amount, so the holder of a call or a
put neither gains nor loses from the payment. Its fair value is the no-dividend value, `q = 0`, up
to the interest on the dividend between the ex-date and expiry (a few centavos). Pricing it with
the stock's yield would subtract the dividend twice. For a 10% payer, a three-month at-the-money
call at 30% volatility would come out about 18% too cheap and the put about 22% too dear (quant
review of PR #350, a Monte Carlo of the protected payoff against Black-Scholes with
`q = ln(1.10)`).

The market agrees. On 2026-08-21, the session before PETR4's R$ 1,19 ex-date, PETR4's September
calls and puts satisfied put-call parity with `q = 0` to within about R$ 0,20 at every strike from
R$ 41 to R$ 47. An unprotected option would have priced the coming R$ 1,19 in. The remaining gap
is the early-exercise premium of American puts at a 14,65% CDI and non-synchronous closes.

The Ibovespa, the only index with listed options the app prices (ADR-0062), is a total return
index: B3 reinvests its constituents' distributions into the index. Its level does not drop on
ex-dates, so `q = 0` is also the right yield for `IBOV11` options.

The engine reads the strike that was live at each instant (ADR-0056 strike epochs, written from
COTAHIST and the registry). Before an ex-date it prices with the unadjusted strike, and from the
ex-date on with the lowered one. That is the protected contract exactly, so nothing in the engine
needs to change.

## Decision

- **`q = 0` is the model for every option the app prices, by design, not by default.** No
  dividend yield source is ingested, and `MarketView.dividendYields` stays empty. The collection
  and `resolveDividendYield` stay in the engine's frozen interface (ADR-0013). They become relevant
  only if the app ever prices an unprotected option, such as an OTC or foreign one.
- **The `dividend_yield_defaulted` note is no longer a warning.** The operation builder stops
  listing it among the notes it shows, and its text in the backtest report and the portfolio says
  why `q` is zero instead of "not found".
- **The IV index keeps `q = 0`** (ADR-0054), now for this reason and not only for the continuity of
  its stored history.
- A pipeline that detected cash distributions from these strike drops was built and reviewed
  (PR #350, first commit) and then removed before merge, because nothing would read it. The
  method it used is recorded here in case a later feature needs distributions, for example to
  show them on the asset page or to credit them to stock held in the portfolio. For each pair of
  consecutive sessions, group the strike changes of physically settled series by their registry
  underlying. Keep an underlying with at least two distinct previous strikes and a positive drop
  shared by at least 90% of its changed series. Skip any underlying with a recorded factor on that
  session. Map series to underlyings through `option_series`, whose rows reach as far back as the
  registry history the app has stored (B3 serves the file only about twelve months back).

## Consequences

- #81 is closed: the IV index half shipped in ADR-0054, and this half needs no data. brapi stays
  the candidate for #24 (intraday) only. The paid dividend source is no longer a reason to
  subscribe.
- No price, implied volatility, greek, backtest or stored artifact changes. Only the note's
  wording and its display in the operation builder change.
- If B3 ever stops protecting a class of options, the evidence above stops holding. The check is
  cheap: compare strikes across an ex-date in that session's COTAHIST.
