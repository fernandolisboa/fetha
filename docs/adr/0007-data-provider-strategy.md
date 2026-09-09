---
status: accepted
date: 2026-09-02
---

# Data providers: public B3 and Bacen files as the shared backbone, a paid intraday tier per user

Reference data (daily candles for stocks and ETFs, option series, daily option prices, corporate
action factors, CDI/Selic/IPCA, the trading calendar) comes from public, licensed-for-personal-use
sources ingested by the daily job: B3 COTAHIST and the B3 instruments registry, Bacen SGS and the
ANBIMA holiday file. It is shared by all users and read-only. Live quotes, the live chain and
intraday candles come from a paid provider through the same `MarketDataProvider` interface,
with a token each user supplies in their settings; the first adapter is brapi.dev Pro (intraday
candles from 1 minute to 1 hour, options chain, ~5-minute refresh, R$ 116,66/month at the time of
writing). Data fetched with a user's token is cached for that user only, so licensing stays
per subscriber. Without a token the app works on reference data alone. Greeks and implied
volatility are always computed by the engine from prices; they are never bought.

## Considered options

- OpLab as the intraday adapter: real-time quotes and chain with greeks, but no intraday
  candles, more expensive (R$ 185/month) and personal-use terms; remains a candidate second
  adapter.
- brapi as the backbone: the free plan covers four tickers and the chain is paid; the public B3
  files cover the same history for free and are the source of truth.
- One app-level provider key with a shared cache: simpler and cheaper for many users, but the
  provider's terms on serving cached data to third parties are not published; revisit if the
  user base grows beyond family and friends.
- Scraping broker or B3 web pages: excluded by the terms-of-service rule.
