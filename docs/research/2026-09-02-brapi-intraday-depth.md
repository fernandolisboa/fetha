# brapi.dev Intraday and Options Chain API Specification

**Date:** 2026-09-02 | **Source:** https://brapi.dev/docs

---

## Question 1: Range and Interval Values, Maximum History Depth

**One-line answer:** Range supports "1d", "2d", "5d", "7d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"; interval supports "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"; maximum history depth varies by subscription plan but specific limits per interval are not documented.

### Details

From https://brapi.dev/docs/acoes/historico:

**Allowed `range` values:** "1d", "2d", "5d", "7d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", or "max". Default: "1mo".

**Allowed `interval` values:** "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", or "3mo". Default: "1d".

**Maximum history depth:** The documentation states "The size of historical data depends on your plan. A request larger than the limit returns the allowed window, not an error." Specific limits per intraday interval (e.g., 1m available for 7 days, 15m/30m/60m for 60 days) are not detailed in the documentation. Users are advised to check pricing plans for specific limits. The documentation also notes: "intraday intervals do not return raw price fields."

---

## Question 2: Intraday Candles for Options Tickers and Options Chain Historical Support

**One-line answer:** Options tickers (e.g., PETRJ350) do NOT support intraday candles (only end-of-day); options chain endpoint provides current snapshot only; historical endpoints exist for Greeks/IV and open interest but not for the options chain itself.

### Details

From https://brapi.dev/docs/opcoes:

**Intraday candles for options:** NOT SUPPORTED. Options data is end-of-day (EOD), processed after approximately 19:00 Brasília time. Daily frequency only, covering stocks and ETFs from 2009 onward; currency options (DOL/WDO) have approximately one year of history.

**Options chain endpoint:** `/api/v2/options/chain` returns current snapshot of all series for an expiration date. No historical form of the main chain endpoint exists.

**Historical endpoints for options data:**

- `/api/v2/options/historical` — historical series data (daily)
- `/api/v2/options/analytics/history` — Greeks and implied volatility time series
- `/api/v2/options/positions/history` — open interest over time

None of these support intraday granularity.

---

## Question 3: Data Freshness (Real-Time vs. Delayed)

**One-line answer:** Data is delayed, not real-time: Free plan ~30 minutes, Startup plan ~15 minutes, Pro plan ~5 minutes for stock quotes; options are end-of-day.

### Details

From https://brapi.dev/faq/qual-a-frequencia:

**Stock quote update frequency and delay by plan:**

| Plan    | Update Frequency | Delay   |
| ------- | ---------------- | ------- |
| Free    | Every 30 minutes | ~30 min |
| Startup | Every 15 minutes | ~15 min |
| Pro     | Every 5 minutes  | ~5 min  |

**Cryptocurrencies and foreign exchange:** Longer delays (~60 min Free, ~30 min Startup, ~5 min Pro).

**Options data:** End-of-day only, processed after 19:00 Brasília time (no intraday updates at any plan level).

**Documentation note:** "Fazer polling a cada segundo não torna a cotação mais recente" — making requests every second does not make quotes fresher than the plan's update cadence.

---

## Question 4: Terms of Use — Caching, Storing, Redistributing, Displaying Data

**One-line answer:** Terms prohibit reselling, redistributing, sublicensing, and proxy/mirror services; no explicit clauses on caching, storing to disk, or displaying to other app users are documented.

### Verbatim Terms

From https://brapi.dev/legal/terms-of-use, Section 2 (Use of API and License):

**Prohibited uses:**

- "Revender, redistribuir ou sublicenciar os Dados ou o acesso à API para terceiros." (Resell, redistribute, or sublicense the Data or API access to third parties.)
- "Criar um serviço de proxy, 'espelho' ou qualquer forma de wrapper em torno da nossa API com o intuito de oferecer um serviço concorrente ou de acesso público." (Create a proxy, mirror, or any wrapper service around our API with the intent to offer a competing or public access service.)

**Implicit restriction:** Data is "exclusivamente para fins informativos" (exclusively for informational purposes).

**Gaps:** The terms do not explicitly address caching duration, local storage rights, or the legality of displaying brapi data within a multi-user app (where all users are the same tenant/family). The prohibition on proxy/mirror services suggests data must not be re-exposed as a service, but the distinction between "display in an app" and "re-expose as a service" is not clarified.

---

## Question 5: Plan Requirements and Pricing

**One-line answer:** Intraday candles for stocks require Startup (R$ 99.99/mo) or higher; options chain requires Pro (R$ 116.66/mo); today's exchange-discounted pricing as of 2026-09-02.

### Details

From https://brapi.dev/pricing:

**Startup Plan**

- Monthly: R$ 99.99 (20% off, regular R$ 124.92)
- Annual: R$ 1,199.90 (17% savings)
- Data update: Every 15 minutes
- Includes: stock quotes, fundamentals, historical candles (intraday intervals)

**Pro Plan**

- Monthly: R$ 116.66 (30% off, regular R$ 166.66)
- Annual: R$ 1,399.90 (17% savings)
- Data update: Every 5 minutes
- Includes: all Startup features + options chains, greeks, implied volatility, options analytics, macro series (CDI/Selic/IPCA)

**Free Plan** (not listed with explicit pricing): 30-minute update frequency, limited features, no options.

**Critical caveat:** From https://brapi.dev/pricing — "Não atende execução de ordens nem estratégias intradiárias de alta frequência" (brapi does not support order execution or high-frequency intraday strategies). Even with Pro, intraday is limited to ~5-minute delay and daily granularity for options.

---

## Summary for Fetha Architecture

1. **Stock intraday candles:** Available (1m–1mo intervals) via Startup plan or higher, with 15–5 min delays.
2. **Options intraday:** Not available; use end-of-day greeks, IV, and open interest endpoints instead.
3. **Backtest data:** Historical endpoint supports full depth (depends on plan); use daily or larger intervals for reproducibility.
4. **Terms risk for multi-user app:** Redistribution and proxy clauses are clear; multi-user display within one household is not explicitly addressed. Recommend confirming with brapi.dev before launching multi-user or before REGISTRATION_MODE=open.
