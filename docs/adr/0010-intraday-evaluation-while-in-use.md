---
status: accepted
date: 2026-09-02
---

# Intraday data and intraday strategies refresh only while the app is in use

Intraday candles, live quotes and the chain are fetched, and intraday strategies are evaluated,
only while a user has the app open: the client asks the server on a fixed cadence (one request
per closed candle of the smallest timeframe in use) and the server calls the provider with that
user's token. No scheduled job polls the market during the session, on Vercel or elsewhere. On
reopening, the app runs a catch-up evaluation over the candles that closed meanwhile, within the
provider's intraday history, and marks late signals as such. Daily ingestion and daily strategy
evaluation stay on the nightly cron (22:00 America/Sao_Paulo, retries at 00:30 and 06:00).
Rationale: the owner uses Fetha from a desktop during the session, per-minute crons would spend
Vercel compute credit for nobody watching, and GitHub Actions schedules drift by 5 to 30 minutes
and consume the owner's scarce minutes.

## Considered options

- Vercel Pro cron every minute: possible on the current plan, but the cost is continuous and
  the benefit accrues only when someone is looking.
- GitHub Actions on a 5-minute schedule: free but unreliable timing and it competes with CI
  minutes.

## Addendum (2026-09-10, #19 round 1)

The nightly cron's ingest-then-evaluate route reports the evaluation's own failures (per-user
errors, `usersSkipped`) in the response body alongside `ok`/`sources`, never as the route's own
5xx: only ingestion failing turns the response into a 5xx that triggers this ADR's retry, since a
session that ingested cleanly must never be re-ingested just because the unrelated evaluation
step had a transient error.
