---
status: accepted
date: 2026-09-27
---

# Per-user caps on backtest runs in progress and on strategy versions (builds on 0018, 0020)

## Context

Finding C-07 of the 2026-09-27 audit (#147). Production registration is `open` (ADR-0020), and the
only limits on backtests were per-account rates: 10 creations and 6 chunks a minute. Each chunk
holds a function for up to 300 s, and nothing bounded how many runs one account kept in flight or
how many versions it wrote to a strategy. The cost lands on the Pro team's included credit
(ADR-0010).

## Decision

- `MAX_ACTIVE_BACKTEST_RUNS = 2` (`backtest-run-repository.ts`): a user holds at most two runs in
  `pending`, `running` or `paused`. `create` counts them and inserts inside one transaction under
  a per-user advisory lock (`pg_advisory_xact_lock` on `backtest_runs:<user id>`), so concurrent
  creates cannot both pass. Resuming a `failed` run (`claim`) enters the same set, so it takes the
  same lock and count. Beyond the cap, `createBacktestRunAction` and `POST /api/backtests/[id]/run`
  answer `too_many_active`, and the page tells the user to finish a run first. Resuming a
  `pending` or `paused` run, or a stale `running` one, is never refused: it is already counted.
- `MAX_VERSIONS_PER_STRATEGY = 100` (`strategies-repository.ts`): `addVersion` refuses the 101st
  version under the strategy row's existing `FOR UPDATE` lock, and the editor answers
  `version_limit`. A new strategy starts its own count; strategies per user were already capped
  at 200.
- Both are ceilings against runaway loops and scripted abuse, not plan limits: the product has no
  plans (CLAUDE.md).

## Consequences

- There is no total cap on completed runs or decisions, because there is no way to delete a run
  yet: a total cap would become a wall the owner cannot get past. Storage stays bounded per
  account by the creation rate only.
- A run abandoned in `pending` or `paused` holds a slot until it is run to the end or fails;
  its page resumes it. Nothing discards a run, and runs are listed per strategy only, so a user at
  the cap looks for the runs in progress strategy by strategy. A run left in `running` by an
  unexpected throw (one `run-chunk.ts` does not turn into `fail`) holds its slot until a claim
  after the lease revives it; a "discard run" action would be the way out if that ever happens.
- No global cap on concurrent chunks across users; many accounts each at the cap remain
  possible with open registration.
