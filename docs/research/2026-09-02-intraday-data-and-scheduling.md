# Intraday Market Data and Scheduling Options

Research compiled 2026-09-02

## 1. OpLab API

### Official Documentation

- **URL**: https://apidocs.oplab.com.br/ (REST API documentation)
- **Date verified**: 2026-09-02

### Endpoints and Data

OpLab provides B3 options and equities data through its REST API with two categories:

- **Domain endpoints**: user-related (portfolio, orders, notifications)
- **Market endpoints**: quotations, option series, interest rates, instruments

The API returns real-time B3 quotes, option series data, and supports portfolio management. Specific endpoint list requires access to the full REST API docs (site currently returns truncated content).

### Data Characteristics

- **Quotes**: Real-time B3 stock and options quotes
- **Options chain**: Yes, available through market endpoints; bid/ask/last and volume supported
- **Candles**: Not explicitly mentioned in available documentation
- **Intraday candles**: Not documented as available
- **Daily historical depth**: Not specified
- **Greeks/IV**: Available (platform displays greeks: delta, gamma, vega, theta, rho; implied volatility heatmaps)
- **Data delay**: Real-time (no documented latency)

### Subscription and Access

**Plans and Pricing**:

- **ONE Plan**: R$83.08/month (annual) or R$97/month (monthly) – no API access
- **PRO Plan**: R$154.17/month (annual) or R$185/month (monthly) – includes API access

**Rate Limits**:

- 50 requests per second
- 100 requests per minute (total)

**Authentication**: Token-based via HTTP header `Access-Token` (one token per request)

### Terms of Service

- **Personal use only**: "API is of exclusively personal use" – data obtained cannot be distributed without prior authorization
- **Data sharing restrictions**: Implicit prohibition on sharing data with other people without prior permission
- **Caching/local storage**: Not explicitly documented; appears to fall under personal use restriction
- **Commercial use**: Not permitted (personal use only)

**Source**: https://oplab.com.br/planos/ (pricing page), https://apidocs.oplab.com.br/ (API docs)

---

## 2. Other Intraday Sources for B3 Stocks and Options

### brapi.dev

**Data availability**:

- Intraday candles: Yes (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h intervals)
- Options chain: Yes (`/api/v2/options/chain` endpoint with series, price, volume; also `/api/v2/options/historical` for specific series)
- Current status: EOD focus; intraday snapshots during trading hours under evaluation for future implementation
- Delay: Not documented
- Data refresh: Free tier every 15 minutes (Startup plan); Pro plan every 5 minutes

**Pricing**:

- Free tier: 15,000 requests/month (four tickers testable without token: PETR4, MGLU3, VALE3, ITUB4)
- Startup: R$99.99/month (150,000 req/month; 15-min refresh)
- Pro: R$116.66/month (500,000 req/month; 5-min refresh; 10+ years history; full options/futures coverage)

**Source**: https://brapi.dev/pricing, https://brapi.dev/docs/opcoes, https://brapi.dev/docs/acoes

---

### Cedro Technologies (Market Data Cedro)

**Data availability**:

- Real-time and delayed data available
- API formats: REST (JSON), Socket, WebSocket
- Options: Available
- Intraday candles: Not explicitly documented in available sources
- Free trial: 7 days

**Pricing**:

- Retail/individual plans: Not publicly listed; custom quotes required
- Target: individuals building investment strategies and robots
- Must contact for pricing (no published BRL rates found)

**Limitations**:

- Enterprise-focused; retail pricing non-standard
- 7-day trial available

**Source**: https://cedrotech.com/market-apis/api-rest/, https://www.marketdatacloud.com.br/, https://cedrotech.com/produtos/market-data-cedro/

---

### Yahoo Finance

**Status**: Official API discontinued May 15, 2017 (no replacement).

**Terms**: No longer accessible via official API. Any programmatic access violates Yahoo's current terms of service.

**Alternatives**: Only unofficial/web-scraping methods available, all against ToS.

**Recommendation**: Not viable for production systems.

**Source**: https://www.bluecoinsapp.com/announcement-yahoo-finance-api-discontinued/, https://medium.com/@dineshjoshi/what-happened-to-the-yahoo-finance-api-857c2a6abb6d, https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html

---

### B3 UP2DATA

**Data availability**:

- Historical EOD data (reference data and pricing, no intraday)
- File formats: TXT, CSV, XML, JSON
- Options: Yes (in historical archive)
- Intraday: No
- Cloud version: 30 days rolling history

**Delivery**:

- File download (manual) or cloud API via Postman/code
- For historical data not on-platform: B3 works with authorized distributors (must request quote)

**Pricing**: Institutional focus; retail access and pricing not documented.

**Source**: https://www.b3.com.br/en_us/market-data-and-indices/data-services/up2data/about-up2data/, https://www.b3.com.br/en_us/market-data-and-indices/data-services/up2data/available-data/

---

### B3 COTAHIST Historical Files

**Format**: Free public historical EOD data from B3.

**Data structure**:

- Record size: 245 bytes per line
- Filename: COTAHIST.AAAA.TXT (AAAA = year)
- Available since 1986
- Includes: company name/code, ISIN, market type (spot, forward, options), prices (open, high, low, close, avg), volume, trade count

**Market types in file**:

- 010 = Spot
- 012 = Call option exercise
- 013 = Put option exercise

**Intraday**: Not available (EOD only).

**Source**: https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/, https://www.b3.com.br/data/files/C8/F3/08/B4/297BE410F816C9E492D828A8/SeriesHistoricas_Layout.pdf

---

## 3. Vercel Cron Limits by Plan

### Frequency and Scheduling

**Hobby Plan**:

- Minimum frequency: Once per day (no sub-daily crons allowed)
- Scheduling precision: Per-hour (±59 minutes; no guarantee of exact time)
- Max crons per project: 100
- Function maxDuration: Can be configured up to 60 seconds (formerly 10 seconds, updated May 2024)
- Cost: Included in free tier (crons invoke functions; function pricing/limits apply)

**Pro Plan**:

- Minimum frequency: Once per minute (`*/1 * * * *`)
- Scheduling precision: Per-minute
- Max crons per project: 100
- Function maxDuration: Can be raised to 5 minutes
- Cost: Included in plan; function invocations billed on demand

**Enterprise**: Contact Vercel for custom limits.

### Pricing

Cron jobs are **free on all plans**; they invoke functions, and function usage/pricing limits apply.

### Important Notes

- **Hobby restriction**: Cron expressions running more frequently than daily **fail at deployment** with error: "Hobby accounts are limited to daily cron jobs. This cron expression would run more than once per day."
- **Timing uncertainty**: Hobby plan cannot assure timely invocation (±59 min drift). For precise timing, upgrade to Pro.
- **Vercel free tier function limits** (Hobby): 4 hours active CPU, 360 GB-hrs provisioned memory, 1M invocations/month included.

**Source**: https://vercel.com/docs/cron-jobs/usage-and-pricing (last updated 2026-07-15), https://vercel.com/changelog/vercel-functions-for-hobby-can-now-run-up-to-60-seconds

---

## 4. GitHub Actions Scheduled Workflows

### Minimum Interval

- **Technical minimum**: Once every 5 minutes (`*/5 * * * *`)
- **Recommended for free tier**: Every 15 minutes or longer (to avoid excessive load)

**Source**: https://docs.github.com/en/actions/learn-github-actions/workflow-syntax-for-github-actions#onschedule

### Free Tier Minutes (Private Repository)

- **GitHub Free plan**: 2,000 Linux minutes per month (for private repos)
- **Linux runner consumption**: 1 minute = 1 minute cost
- **Windows runner consumption**: 1 minute = 2 minutes cost (2x multiplier)
- **macOS runner consumption**: 1 minute = 10 minutes cost (10x multiplier)
- **Public repo workflows**: Unlimited minutes (free tier runners used)

### Calculation Example: B3 Intraday Hours with 5-Minute Schedule

B3 regular session: 10:00–17:00 BRT (Monday–Friday) = 7 hours = 420 minutes

With 5-minute interval during B3 hours (10:00–17:00):

- Invocations per day: 420 ÷ 5 = 84 runs
- Invocations per month (weekdays only): 84 × 21 days ≈ 1,764 runs
- **Linux minutes consumed**: 1,764 (assuming sub-1-minute execution)
- **Remaining free quota**: 2,000 – 1,764 = 236 minutes

Feasible on free tier if execution stays under 1 second per run. Any longer execution will exceed the monthly quota.

### Timing Reliability

- **Scheduling delay**: Common delays of 5–30 minutes during periods of high GitHub Actions load
- **No SLA**: GitHub makes no guarantee on execution timing
- **Unreliability note**: Not suitable for strict trading windows or time-sensitive operations

**Source**: https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions, https://cicdcalculator.com/github-actions-free-tier

---

## 5. B3 Trading Hours (2026)

### Regular Session

**Equities, ETFs, Units, BDRs, Fractional Shares**:

- Pre-market (order cancellation): 09:30–09:45
- Pre-opening (price discovery): 09:45–10:00
- Trading: **10:00–16:55**
- Closing call: 16:55–17:00
- **Summary: 10:00–17:00 BRT** (380 minutes, 6 hours 20 minutes)

**Options on stocks/ETFs**:

- Same as equities above

### After-Market Session

**Time period**: 17:25–17:30 (5 minutes of trading)

**Special case - Options expiration**: 18:25–18:40 (trading) + 18:45–19:00 (order cancellation)

### Derivatives Market

- **Futures, indices, currencies**: 09:00–17:30 (with extended to 18:25 on specific products)
- Outside equities scope; separate market segment

### Time Zone

**Americas/Sao_Paulo (BRT)**: UTC-3 year-round (no daylight saving in Brazil)

**Note**: March 9, 2026 change mentioned in 2024 announcements indicates possible extended trading to 17:00 (currently confirmed at 16:55 close, 17:00 final)

**Source**: https://www.b3.com.br/en_us/solutions/platforms/puma-trading-system/for-members-and-traders/trading-hours/equities/, https://globalexchanges.com/latest-news/brazil-b3-announces-changes-to-trading-hours-2/144300/

---

## Intraday Providers Comparison Table

| Provider              | Price (monthly, BRL) | Real-time delay          | Options chain             | Intraday candles | Intraday resolution | History depth   | Personal-use terms                         |
| --------------------- | -------------------- | ------------------------ | ------------------------- | ---------------- | ------------------- | --------------- | ------------------------------------------ |
| **OpLab API**         | R$185 (PRO plan)     | Real-time                | Yes                       | No               | N/A                 | N/A             | Personal use only; no redistribution       |
| **brapi Pro**         | R$116.66             | 5 min refresh            | Yes (v2 endpoints)        | Yes              | 1m–1h               | 10+ years       | Not explicitly restricted (token required) |
| **brapi Startup**     | R$99.99              | 15 min refresh           | Yes (sandbox: PETR4 only) | Yes              | 1m–1h               | 1 year          | Not explicitly restricted                  |
| **brapi Free**        | Free                 | N/A                      | Yes (sandbox: PETR4 only) | Yes              | 1m–1h               | Limited         | 15k req/month (4 tickers)                  |
| **Cedro Market Data** | Custom (call)        | Real-time (milliseconds) | Yes                       | Not documented   | N/A                 | Not documented  | Enterprise/individual (no public retail)   |
| **B3 UP2DATA**        | Institutional (N/A)  | EOD only                 | Yes                       | No               | N/A                 | 30 days (cloud) | Institutional; retail access unclear       |
| **B3 COTAHIST**       | Free                 | EOD only                 | Yes                       | No               | N/A                 | 1986–present    | Public domain                              |
| **Yahoo Finance**     | Discontinued         | N/A                      | N/A                       | N/A              | N/A                 | N/A             | **ToS violated; API shut down 2017**       |

---

## Scheduling Options Comparison Table

| Mechanism                 | Min interval | Max interval | Reliability            | Cost                   | Vercel Hobby compatible | GitHub Free compatible                                  |
| ------------------------- | ------------ | ------------ | ---------------------- | ---------------------- | ----------------------- | ------------------------------------------------------- |
| **Vercel Cron (Hobby)**   | 1/day        | Any          | ±59 min drift          | Free (included)        | Yes (only option)       | N/A                                                     |
| **Vercel Cron (Pro)**     | 1/min        | Any          | Per-minute             | Included               | Yes                     | N/A                                                     |
| **GitHub Actions (free)** | 5 min        | Any          | 5–30 min common delays | Free (2k min/mo Linux) | N/A                     | Yes (barely: ~1.76k min/mo at 5m intervals in B3 hours) |
| **GitHub Actions (paid)** | 5 min        | Any          | 5–30 min common delays | $0.007/min Linux       | N/A                     | Yes                                                     |

### Recommendation for B3 Intraday (10:00–17:00 BRT)

**For 5-minute data ingestion**:

- **Vercel Cron**: Not available (Hobby limited to 1/day; Pro required)
- **GitHub Actions free**: Technically feasible (2,000 min/mo; ~1,764 min consumed); fails only if execution > 1 sec/run; **high timing uncertainty** (5–30 min delays)
- **Best practice**: Vercel Pro with 1-minute cron (timing precision, no drift, no minute quota) or GitHub Actions with escalated tolerance for delivery window (5–30 min slide)

---

## Notes for Fetha Implementation

1. **OpLab API** provides real-time B3 options and equities quotes with Greeks, but no intraday candles; personal-use restriction requires explicit clause in terms.
2. **brapi.dev Pro** (R$116.66/mo) covers intraday candles + options chains; 5-min data refresh; most accessible for v1 intraday.
3. **B3 COTAHIST** (free) handles historical EOD backtests; no intraday component.
4. **GitHub Actions timing drift** (5–30 min common) unsuitable for live intraday if sub-minute precision required; Vercel Pro cron preferred.
5. **Cedro Technologies** exists but retail pricing/availability unclear; requires direct inquiry.
6. **Data retention/redistribution**: brapi.dev ToS not explicitly documented here; verify before local caching or multi-user sharing plan.
