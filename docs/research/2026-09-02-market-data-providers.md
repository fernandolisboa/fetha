# Fetha Data Provider Research — Phase 1

**Date:** 2026-09-02  
**Status:** Primary documentation review only  
**Scope:** Capabilities, limits, authentication, terms, and payload shapes for six Brazilian market data sources

---

## 1. brapi.dev

**URL:** https://brapi.dev  
**Source:** [Pricing page](https://brapi.dev/pricing), [Documentation](https://brapi.dev/docs), [FAQ](https://brapi.dev/faq/como-a-api-e-calculada)

### Capabilities

| Feature                       | Coverage                                                      | Notes                                                                         |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Quotes**                    | PETR4, MGLU3, VALE3, ITUB4 (free); all tickers (paid)         | Real-time/EOD depending on plan                                               |
| **Historical Candles**        | 1 year (free) to 10+ years (Pro)                              | Daily data, `date`, `open`, `high`, `low`, `close`, `adjustedClose`, `volume` |
| **Fundamentals**              | Available via `defaultKeyStatistics`, `financialData` modules | Annual/Quarterly statements                                                   |
| **Dividends & Distributions** | Yes                                                           | JCP, bonuses, stock subscriptions included                                    |
| **Options Chain**             | `/api/v2/options/chain` endpoint                              | Requires Pro plan ($116.66/month); PETR4 free for testing                     |
| **Options Greeks/IV**         | Delta, gamma, vega, theta, rho                                | Pro plan only; historical back to 2009 (equities), ~1 year (currency options) |
| **Options Historical**        | Available                                                     | EOD updates ~19:00 São Paulo time (America/Sao_Paulo TZ)                      |
| **Macro Series**              | SELIC, CDI, IPCA, Treasury Direct                             | Fixed income endpoints included                                               |

### Free Tier Limits

- **Monthly requests:** 15,000 requests/month
- **Stocks per request:** 1 stock per request
- **Total tickers/month:** 15,000 unique stock references
- **Coverage:** PETR4, MGLU3, VALE3, ITUB4 only (without token)
- **Data freshness:** Older historical data (exact delay not specified)
- **No authentication required** for these four tickers

Source: [brapi.dev pricing page](https://brapi.dev/pricing), [FAQ](https://brapi.dev/faq/api-e-gratis-mesmo)

### Paid Tier Limits

| Plan        | Monthly Cost | Annual Cost          | Requests/Month | Stocks/Request | Update Freq  | Historical |
| ----------- | ------------ | -------------------- | -------------- | -------------- | ------------ | ---------- |
| **Startup** | R$99.99      | R$1,199.90 (20% off) | 150,000        | 10             | Every 15 min | 1 year     |
| **Pro**     | R$116.66     | R$1,399.90 (30% off) | 500,000        | Unlimited      | Every 5 min  | 10+ years  |

Source: [brapi.dev pricing page](https://brapi.dev/pricing)

### Authentication

- **Method:** Bearer token (recommended) or query parameter `?token=` (not recommended for frontend use)
- **Header format:** `Authorization: Bearer YOUR_TOKEN`
- **Status:** Token **required** for all tickers except the four free stocks; registration at dashboard required to obtain token

**Security note:** "Never put the token in code running in the browser. Call brapi from your backend."

Source: [brapi.dev documentation](https://brapi.dev/docs)

### Terms of Use — Licensing & Redistribution

- **Commercial use:** Permitted under paid plans; see [commercial use FAQ](https://brapi.dev/faq/posso-utilizar-a-api-para-fins-comerciais)
- **Storage:** Implicit allowance under paid subscription (not explicitly stated; requires confirmation via direct contact)
- **Redistribution:** No explicit clause found in search; **requires verification**
- **Rate limit exceeded:** Returns HTTP error `RATE_LIMIT_EXCEEDED` with message "Limite de requisições excedido"

**Open question:** Exact terms regarding data caching, storage duration, and redistribution restrictions.

### Payload Shape — `/quote/{ticker}`

```json
{
  "results": [
    {
      "symbol": "PETR4",
      "name": "Petrobras S.A.",
      "lastPrice": 25.50,
      "open": 25.20,
      "high": 26.00,
      "low": 25.10,
      "close": 25.50,
      "adjustedClose": 25.50,
      "volume": 12345678,
      "historicalDataPrice": [
        {
          "date": "2026-09-01",
          "open": 25.20,
          "high": 26.00,
          "low": 25.10,
          "close": 25.50,
          "volume": 12345678
        }
      ],
      "fundamental": {
        "defaultKeyStatistics": {
          "marketCap": "...",
          "trailingPE": "...",
          ...
        },
        "financialData": {
          "totalRevenue": "...",
          "netIncome": "...",
          ...
        }
      }
    }
  ]
}
```

Source: [brapi.dev blog articles](https://brapi.dev/blog/dados-historicos-b3-python-pandas-api)

### Open Questions

1. What is the exact rate limit behavior if you hit 500,000 requests/month on Pro? (Hard cutoff or throttling?)
2. Explicit data redistribution and commercial resale restrictions?
3. How is `historicalDataPrice` length determined for free vs. paid tiers?
4. Exact delay (minutes) between EOD close and data availability?

---

## 2. B3 COTAHIST

**Official source:** [B3 Historical Quotations documentation](https://www.b3.com.br/data/files/65/50/AD/26/29C8B51095EE46B5790D8AA8/HistoricalQuotations_B3.pdf)  
**Layout reference:** [B3 format specification PDF](https://www.b3.com.br/data/files/C8/F3/08/B4/297BE410F816C9E492D828A8/SeriesHistoricas_Layout.pdf) (via rb3 package docs)  
**Download:** [B3 data download page](https://www.b3.com.br/pt_br/noticias/dados-para-download.htm)

### Capabilities

| Feature                | Coverage                                                                                | Notes                                        |
| ---------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Quotes**             | All B3-traded assets                                                                    | Historical only (no real-time)               |
| **Daily Candles**      | Open, high, low, close, volume                                                          | Record type 01; fixed-width format           |
| **Intraday**           | No                                                                                      | End-of-day only                              |
| **Fundamentals**       | No                                                                                      | Quotations and derivatives only              |
| **Options Chain**      | Yes; strike, expiry in records                                                          | PREEXE (strike), DATVEN (expiry date) fields |
| **Options Historical** | Yes; full contract history                                                              | Included in record type 01                   |
| **Greeks/IV**          | No                                                                                      | Not provided by COTAHIST                     |
| **Asset coverage**     | Stocks, options, forwards, ETFs, ETF options, BDRs, UNITs, REITs (FIIs), FIAGROs, FIDCs | All market segments                          |

### File Format & Availability

**File naming:** `COTAHIST.AAAA.TXT` (where AAAA = year)  
**Availability levels:**

- **Annual:** Earliest available: 1986 (not recommended before 1995 due to Plano Real)
- **Monthly:** Available (format not detailed)
- **Daily:** Earliest available: January 2, 2014

**Update cadence:** End-of-day; published D+1 (next business day)

**File size:** Fixed record length = 245 bytes per line

Source: [rb3 documentation](https://docs.ropensci.org/rb3/reference/cotahist_get.html)

### Fixed-Width Record Specification

#### Record Type 00 (Header)

- **Bytes 1–2:** `00` (fixed)
- **Bytes 3–13:** `COTAHIST.AAAA` (filename)
- **Bytes 14–20:** `BOVESPA` (source code, fixed)
- **Bytes 21–28:** Generation date `YYYYMMDD`
- **Bytes 29–245:** Reserved (blank)

#### Record Type 01 (Daily Quotations)

| Field                     | Position (bytes) | Format                  | Example                       |
| ------------------------- | ---------------- | ----------------------- | ----------------------------- |
| Record Type               | 1–2              | `01`                    | `01`                          |
| Reference Date            | 3–10             | `YYYYMMDD`              | `20260902`                    |
| BDI Code (CODBDI)         | 11–12            | Numeric (2)             | `01` (stock), `27` (option)   |
| Ticker (CODNEG)           | 13–24            | Alphanumeric (12)       | `PETR4`                       |
| Market Type (TPMERC)      | 25–27            | Numeric (3)             | `010` (cash), `020` (forward) |
| Company Name (NOMRES)     | 28–39            | Alphanumeric (12)       | Abbreviated corp name         |
| Specification (ESPECI)    | 40–49            | Alphanumeric (10)       | Option type, series           |
| Days to Settlement        | 50–52            | Numeric (3)             | Forward market term           |
| Currency (MODREF)         | 53–56            | Alphanumeric (4)        | `R$  `                        |
| Open                      | 57–71            | Numeric with 2 decimals | Price in cents/units          |
| High                      | 72–86            | Numeric with 2 decimals |                               |
| Low                       | 87–101           | Numeric with 2 decimals |                               |
| Close/Settlement          | 102–116          | Numeric with 2 decimals |                               |
| Volume                    | 117–130          | Numeric                 | Units traded                  |
| Strike Price (PREEXE)     | 189–201          | Numeric `(11)V99`       | Options only; in cents        |
| Expiry Date (DATVEN)      | 203–210          | `YYYYMMDD`              | Options/forwards only         |
| Quotation Factor (FATCOT) | 211–217          | Numeric (7)             | `1` = unit; `1000` = per lot  |

**FATCOT semantics:** Divisor for price reconstruction. Example: `FATCOT=1000` means divide displayed price by 1000 to get true price.

#### Record Type 99 (Trailer)

- **Bytes 1–2:** `99` (fixed)
- **Bytes 3–7:** Total records in file
- **Bytes 8–245:** Reserved

Source: [B3 Historical Quotations PDF](https://www.b3.com.br/data/files/65/50/AD/26/29C8B51095EE46B5790D8AA8/HistoricalQuotations_B3.pdf), [rb3 R package docs](https://docs.ropensci.org/rb3/reference/cotahist_get.html)

### Licensing & Terms

- **Access:** Free to download from B3 website (personal use, public data)
- **Redistribution:** Allowed for end-of-day and historical data under B3 Market Data Consumption Policy
- **Commercial use:** Requires B3 Market Data distribution agreement if redistributing or using in a commercial product
- **Real-time data:** Requires separate licensing and payment (not applicable to COTAHIST)
- **No price adjustment:** Prices in files are NOT adjusted for corporate actions (splits, dividends, capital adjustments) — users must handle separately
- **Data quality caveat:** Only ETF series can be used without issues; equity options may have missing or inconsistent records

Source: [B3 Market Data Consumption Policy (Sept 2025)](https://www.b3.com.br/data/files/3A/E2/3F/56/B73699100A29E189AC094EA8/Market%20Data%20B3%20Consumption%20Policy.pdf)

### Open Questions

1. Where is the authoritative B3 download link for annual/monthly/daily files? (Current links via `dados-para-download.htm` may be incomplete)
2. Exact lag: is COTAHIST published same day (after close) or next business day?
3. For options, are all contract status records included (exercised, expired, cancelled)?
4. What is the exact TPMERC code range and meaning for all market types (beyond cash/forward)?
5. Is price adjustment data available separately, or must users track corporate actions manually?

---

## 3. B3 Public Files — Cadastro de Instrumentos

**Official source:** [B3 Cadastro de Instrumentos (Listado)](https://arquivos.b3.com.br/tabelas/InstrumentsConsolidated/2025-01-16?lang=pt)  
**Documentation:** [B3 Glossary (2024)](https://www.b3.com.br/data/files/52/74/1E/14/4BA6D8103152D4C8AC094EA8/Glossario%20InstrumentsConsolidatedFile%202024.pdf)  
**Metadata:** [B3 Market Data description page](https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/boletins-diarios/pesquisa-por-pregao/descricao-dos-arquivos/)

### Capabilities

| Feature                 | Coverage                                               | Notes                                                 |
| ----------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| **Instruments List**    | All B3 instruments (stocks, options, FIIs, ETFs, etc.) | Consolidated registry                                 |
| **Options Chain**       | Strike, expiry dates, contract identifiers             | Via CODNEG (negotiation code) and instrument metadata |
| **Market Type Codes**   | Yes                                                    | TPMERC classification                                 |
| **Asset Type Codes**    | Yes                                                    | BDI and other classification fields                   |
| **Real-time Greeks/IV** | No                                                     | Identifiers only; Greeks must come from other sources |

### File Format & Access

**File name:** `InstrumentsConsolidated` or (historical) `Cadastro de Instrumentos - BVBG.028.01`  
**Format:** CSV  
**Encoding:** UTF-8  
**Update cadence:** Morning (before trading) and evening (after trading)  
**URL pattern:** `https://arquivos.b3.com.br/tabelas/InstrumentsConsolidated/{YYYY-MM-DD}?lang=pt`

### Key CSV Fields (from glossary)

| Field                      | Description                | Relevant for Options?     |
| -------------------------- | -------------------------- | ------------------------- |
| `TckrSymb` (Ticker Symbol) | e.g., `PETR4`, `VALE5F26`  | Yes (contract identifier) |
| `RptDt` (Report Date)      | `YYYY-MM-DD`               | Yes                       |
| `Asst` (Asset)             | e.g., `PETR`, `DOL`, `BGI` | Yes (underlying)          |
| `CFICode`                  | ISO 10962 classification   | Yes (option=OCXXXXXX)     |
| `Strike Price`             | Options only               | Yes                       |
| `Maturity Date`            | Options only               | Yes                       |
| `BDI Code`                 | Market classification      | Implicit (27 = options)   |

### Licensing

- **Access:** Public data, free download
- **Redistribution:** Allowed (part of B3's public data policy for EOD/historical)
- **Terms:** Use for informational and personal purposes; consult B3 for commercial redistribution

Source: [B3 Market Data Consumption Policy](https://www.b3.com.br/data/files/3A/E2/3F/56/B73699100A29E189AC094EA8/Market%20Data%20B3%20Consumption%20Policy.pdf)

### Open Questions

1. What is the complete CSV schema (all field names and types)?
2. How often are option strikes and expiries updated during the trading day (only at open/close)?
3. Are inactive/delisted instruments retained in historical snapshots?
4. Exact format of strike price field (decimal places, currency)?

---

## 4. OpLab

**URL:** https://oplab.com.br/  
**Source:** [OpLab platform](https://oplab.com.br/), [OpLab portal](https://opcoes.oplab.com.br/mercado)

### Capabilities

| Feature                     | Coverage                        | Notes                                      |
| --------------------------- | ------------------------------- | ------------------------------------------ |
| **Options Chain**           | Real-time (PRO plan only)       | Bid/ask, volume, open interest             |
| **Greeks**                  | Delta, gamma, vega, theta, rho  | PRO plan; calculated/streamed in real-time |
| **Implied Volatility (IV)** | Yes; IV Rank, IV Percentile     | PRO plan                                   |
| **Historical Data**         | Limited (not explicitly stated) | Likely EOD snapshots only                  |
| **Portfolio Management**    | Stocks, options, REITs          | Simulation and execution                   |

### Access & Pricing

**Plans:**

- **Free plan:** Limited access; no API
- **PRO plan:** R$154.17/month (annual) or R$185/month (monthly)

**API availability:** PRO plan only

Source: [OpLab pricing / platform](https://oplab.com.br/)

### Rate Limits & Constraints

- **Request limit:** 50 requests per second (HTTP 503 if exceeded)
- **Minute limit:** 100 requests per minute (HTTP 429 with 5-minute blocking on violation)
- **Use case:** Personal and non-commercial only

Source: [OpLab API documentation](https://oplab.com.br/)

### Authentication

- **Method:** Likely token-based (exact scheme not documented in search results)
- **Access:** Requires PRO plan subscription and dashboard login

### Terms of Use — Critical Restriction

**Personal use only.** Exact quote from documentation:

> "O acesso à API é permitido somente para uso pessoal e não comercial. Qualquer utilização com fins comerciais sem autorização expressa da plataforma é proibida e poderá resultar em penalidades conforme previsto nos termos de serviço."

**Translation:** "API access is permitted exclusively for personal and non-commercial use. Any commercial use without express authorization from the platform is prohibited and may result in penalties as provided in the terms of service."

**Commercial use:** Requires explicit written authorization; penalties for unauthorized commercial use are specified in terms of service (details not publicly available).

Source: [OpLab documentation](https://oplab.com.br/)

### Payload Format

- Not documented in public sources; requires access to PRO API reference (behind authentication)

### Open Questions

1. What is the exact REST API response format for options chain and Greeks?
2. How far back does historical data extend?
3. What authentication scheme (Bearer, API key, session)?
4. What is the exact penalty for commercial use violation?
5. Can personal-use data be used for internal (non-sale, non-redistribution) portfolio analytics?

---

## 5. Bacen SGS (Sistema Gerenciador de Séries Temporais)

**Official API:** https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados  
**Portal:** [Banco Central Open Data](https://dadosabertos.bcb.gov.br/)  
**Documentation:** [Python-bcb SGS guide](https://wilsonfreitas.github.io/python-bcb/sgs.html)  
**Series list:** [30,000+ series available](https://www3.bcb.gov.br/sgspub/)

### Capabilities

| Feature                       | Series Code | Coverage     | Notes                    |
| ----------------------------- | ----------- | ------------ | ------------------------ |
| **CDI daily**                 | `12`        | 1986–present | % a.d. (percent per day) |
| **SELIC rate (effective)**    | `11`        | 1986–present | % a.d.                   |
| **SELIC meta (target)**       | `432`       | 2005–present | % a.a. (per annum)       |
| **IPCA (inflation)**          | `433`       | 1979–present | % a.m. (per month)       |
| **Currency, futures, credit** | 100+ series | Varies       | See series catalog       |

### API Endpoint & Parameters

**Endpoint:** `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{SERIES_CODE}/dados`

**Query parameters:**

- `formato=json` or `csv` (default: HTML table)
- `dataInicial=DD/MM/YYYY` (required as of March 26, 2025)
- `dataFinal=DD/MM/YYYY` (required)

**Example:**

```
https://api.bcb.gov.br/dados/serie/bcdata.sgs.11/dados?formato=json&dataInicial=01/01/2020&dataFinal=31/12/2024
```

Source: [Bacen SGS documentation](https://wilsonfreitas.github.io/python-bcb/sgs.html), [Open Data Portal](https://dadosabertos.bcb.gov.br/dataset/11-taxa-de-juros---selic)

### Date Range Limit (Critical)

**As of March 26, 2025:** The API enforces a **maximum 10-year window per request.**

This means:

- A single request cannot span more than 10 years
- Queries for 30-year historical data (common in finance) require multiple calls with different date ranges
- Rate limiting appears to be per-request volume, not per-endpoint

**Example workaround:**

```
Request 1: 01/01/2006–31/12/2015 (10 years)
Request 2: 01/01/2016–31/12/2025 (10 years)
```

Source: [BCB API 10-year window article (DEV.to)](https://dev.to/fmaignacio/como-eu-resolvi-o-limite-de-10-anos-da-api-do-banco-central-do-brasil-com-python-poh), [Bacen documentation](https://wilsonfreitas.github.io/python-bcb/sgs.html)

### Response Format — JSON

```json
[
  {
    "data": "01/01/2020",
    "valor": "4.51"
  },
  {
    "data": "02/01/2020",
    "valor": "4.50"
  }
]
```

**Field types:**

- `data`: String `DD/MM/YYYY`
- `valor`: String (numeric, decimal separator = `.`)

### Rate Limits & Access

- **Rate limit:** Not explicitly documented; appears to be enforced per query size
- **No authentication required** (open data)
- **Timeout:** May require custom timeouts for large queries (>10 years equivalent)

Source: [Python-bcb documentation](https://wilsonfreitas.github.io/python-bcb/sgs.html)

### Terms of Use

- **Status:** Open data (Public)
- **Licensing:** No explicit license stated; implied CC-0 or similar (government data)
- **Redistribution:** Allowed (Brazilian government open data)
- **Commercial use:** Allowed (no restrictions found)

Source: [Banco Central do Brasil Open Data Portal](https://dadosabertos.bcb.gov.br/)

### Open Questions

1. Is the 10-year window a hard limit or a soft recommendation for performance?
2. Exact rate limits per time period (requests/minute or /hour)?
3. Which series have data back to 1986 vs. more recent starts?
4. Guaranteed SLA / uptime?

---

## 6. B3 Trading Calendar

**Official source:** [B3 Calendário de Negociação (Holidays)](https://www.b3.com.br/pt_br/solucoes/plataformas/puma-trading-system/para-participantes-e-traders/calendario-de-negociacao/feriados/)  
**ANBIMA reference:** [ANBIMA Feriados Bancários](https://www.anbima.com.br/feriados/feriados.asp)

### Available Calendars

| Source          | Coverage                                 | Format                          | Update Cadence                                    | URL                                                                                                                                                   |
| --------------- | ---------------------------------------- | ------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B3 official** | National holidays + internal B3 closures | HTML tables on webpage          | Yearly (published in December for following year) | [B3 Calendário](https://www.b3.com.br/pt_br/solucoes/plataformas/puma-trading-system/para-participantes-e-traders/calendario-de-negociacao/feriados/) |
| **ANBIMA**      | National banking holidays                | HTML + downloadable spreadsheet | Yearly; covers 2001–2099                          | [ANBIMA Feriados](https://www.anbima.com.br/feriados/feriados.asp)                                                                                    |

### Key Holiday Rules

- **Closed on:** New Year (Jan 1), Carnival (varies), Good Friday, Tiradentes (Apr 21), Independence Day (Sept 7), All Souls (Nov 2), Republic Day (Nov 15)
- **Partial trading:** Ash Wednesday (afternoon only); Good Thursday (business day since 2000 under Resolution 2.516)
- **No trading:** December 24, 31 (internal banking activities, not official holidays)
- **Municipal holidays NOT observed:** São Paulo anniversary (Jan 25), Constitutional Revolution Day (July 9) — B3 has operated normally on these since 2022

### File Availability

**B3 calendar:**

- **Format:** HTML tables embedded on webpage; **no CSV/TXT download link available**
- **Years:** 2021, 2022, 2023 visible on current page (archive older years)
- **Required action:** Manual extraction or scraping

**ANBIMA calendar:**

- **Format:** HTML + downloadable spreadsheet (likely `.xls` or `.xlsx`)
- **Coverage:** 2001–2099
- **Source:** https://www.anbima.com.br/feriados/feriados.asp

### Licensing

- **ANBIMA data:** Public, free to use (banking industry standard)
- **B3 calendar:** Free public information
- **Redistribution:** Permitted (public data)

Source: [B3 holiday page](https://www.b3.com.br/pt_br/solucoes/plataformas/puma-trading-system/para-participantes-e-traders/calendario-de-negociacao/feriados/), [ANBIMA Feriados](https://www.anbima.com.br/feriados/feriados.asp)

### Open Questions

1. Is there an official API endpoint or downloadable calendar file (CSV/JSON) from B3 or ANBIMA?
2. How are partial trading days encoded (e.g., Ash Wednesday)?
3. Does B3 calendar include intraday market hours, or only open/closed status?
4. How early are future years' holidays published?

---

## Comparison: Feature Coverage & Licensing Summary

### Feature Matrix

| Feature                             | brapi.dev | B3 COTAHIST | Cadastro   | OpLab      | Bacen SGS | B3 Calendar |
| ----------------------------------- | --------- | ----------- | ---------- | ---------- | --------- | ----------- |
| **Quotes (real-time)**              | ✅ Paid   | ❌ EOD only | ❌ No      | ✅ PRO     | ❌ No     | ❌ No       |
| **Daily candles (1Y free)**         | ✅        | ✅          | ❌ No      | ❌ No      | ❌ No     | ❌ No       |
| **Historical candles (10Y+)**       | ✅ Paid   | ✅          | ❌ No      | ⚠️ Limited | ❌ No     | ❌ No       |
| **Fundamentals**                    | ✅ Paid   | ❌ No       | ❌ No      | ❌ No      | ❌ No     | ❌ No       |
| **Options chain**                   | ✅ Paid   | ✅          | ✅ (IDs)   | ✅ PRO     | ❌ No     | ❌ No       |
| **Options historical**              | ✅ Paid   | ✅          | ⚠️ Partial | ⚠️ Limited | ❌ No     | ❌ No       |
| **Greeks/IV**                       | ✅ Paid   | ❌ No       | ❌ No      | ✅ PRO     | ❌ No     | ❌ No       |
| **Macro series (CDI, Selic, IPCA)** | ✅ Paid   | ❌ No       | ❌ No      | ❌ No      | ✅ Free   | ❌ No       |
| **Trading calendar**                | ❌ No     | ❌ No       | ❌ No      | ❌ No      | ❌ No     | ✅ Free     |

Legend: ✅ Full support | ⚠️ Partial/limited | ❌ Not available

### Licensing & Commercial Use Red Flags

| Provider        | License Type     | Free Tier?   | Paid Tiers          | Commercial Use                    | Storage/Redistribution | ⚠️ Red Flags                                                                           |
| --------------- | ---------------- | ------------ | ------------------- | --------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| **brapi.dev**   | Proprietary SaaS | ✅ (limited) | ✅ R$99–117/mo      | ✅ Allowed (paid)                 | **Not explicit**       | No public ToS; need to verify redistribution rules                                     |
| **B3 COTAHIST** | Public EOD data  | ✅           | N/A (free)          | ✅ Allowed (EOD)                  | ✅ Yes (EOD)           | Requires B3 agreement for commercial resale; price adjustment not included             |
| **Cadastro**    | Public registry  | ✅           | N/A (free)          | ✅ Allowed                        | ✅ Yes                 | CSV format/schema not fully documented; field mapping incomplete                       |
| **OpLab**       | Proprietary SaaS | ⚠️ (limited) | ✅ PRO R$154–185/mo | ❌ **Strictly personal use only** | ⚠️ Personal only       | **CRITICAL:** Commercial use prohibited without authorization; penalties not disclosed |
| **Bacen SGS**   | Open government  | ✅           | N/A (free)          | ✅ Allowed                        | ✅ Yes                 | 10-year window limit (March 2025 rule change); must chain requests                     |
| **B3 Calendar** | Public data      | ✅           | N/A (free)          | ✅ Allowed                        | ✅ Yes                 | No API; HTML scraping required; ANBIMA spreadsheet preferable                          |

### Licensing Summary

**✅ Safe for redistribution (with conditions):**

- **B3 COTAHIST:** End-of-day/historical data free to redistribute; requires Market Data agreement for commercial resale
- **Bacen SGS:** Open government data; free commercial use
- **B3 Calendar:** Public data; free redistribution

**⚠️ Requires careful review:**

- **brapi.dev:** Terms of service not publicly visible; need to confirm data storage/redistribution clauses before production use
- **Cadastro:** Public but schema incomplete; need B3 glossary document

**❌ Restricted:**

- **OpLab:** **Personal use only; commercial use strictly prohibited without written authorization.** Fetha should avoid OpLab for any commercial product.

---

## Recommended Next Steps

1. **brapi.dev:** Fetch and review full terms of service (likely behind login); clarify commercial redistribution restrictions
2. **COTAHIST:** Download sample file; validate parser against official B3 layout spec (PDFs referenced above)
3. **OpLab:** Only if Fetha is personal/educational; commercial use requires separate negotiation
4. **Bacen SGS:** Implement 10-year chunking for historical queries; validate request rate limits in production
5. **Calendar:** Choose ANBIMA spreadsheet over B3 HTML (easier parsing; covers 2001–2099)

---

**Document version:** 1.0  
**Last updated:** 2026-09-02  
**Status:** Ready for ADR review  
**Next phase:** Integration POC for each provider
