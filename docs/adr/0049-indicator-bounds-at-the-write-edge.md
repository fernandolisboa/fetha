---
status: accepted
date: 2026-09-29
---

# Indicator parameters are bounded where a definition is written, not where one is read (#249)

## Context

Since ADR-0048 an `ema`, `rsi` or `atr` reading walks `3 * length` or `6 * length` sessions at
every evaluated candle, and `dataWindow` requests that much history. `indicatorSpecSchema` took any
`length >= 1` and any `lookbackSessions >= 2`, so a strategy saved with `length: 100000` made every
backtest step and every nightly evaluation of it load and walk that many sessions: one user could
exhaust their own backtest chunks and slow the nightly job for everyone.

Stored strategy versions, backtest snapshots and decisions all parse their definition with
`strategyDefinitionSchema` on read. A bound added to that schema would make any version already
saved above it unreadable (the repository's `parse` throws), and production data cannot be checked
from the session that ships the bound.

## Decision

- `MAX_INDICATOR_LENGTH = 500` and `MAX_IV_RANK_LOOKBACK_SESSIONS = 1260` (five years of sessions)
  live in `packages/contracts/src/indicator-spec.ts`. At 500, the widest reading (`rsi`, `atr`)
  walks 3,000 sessions per evaluated candle.
- `strategyDefinitionInputSchema` is `strategyDefinitionSchema` plus a refinement that every
  indicator in the entry condition and in every `condition` exit rule is within those bounds. The
  write edge parses with it: `createStrategyAction`, `addStrategyVersionAction` and the editor's
  own pre-submit check. The editor's number fields carry the same `max` and say "No máximo 500".
- Every read path keeps `strategyDefinitionSchema`, which has no upper bound. A version stored
  above a bound stays readable, backtestable and evaluable; saving a new version of it requires
  bringing the parameter within the bound.
- Copying a shared strategy copies its stored definition as is: the copy is a read of data that
  already passed the write edge of its time.

## Consequences

- Only strategies saved before this change can exceed the bounds, and they keep their old cost.
  If one turns out to exist and to matter, a follow-up can cap it at evaluation time; nothing
  suggests one does.
- A later tightening follows the same rule: bound the input schema, never the stored one.
- `MAX_CONDITION_DEPTH` predates this rule and stays on the shared schema: no stored definition
  could have exceeded it when it shipped.
