---
status: accepted
date: 2026-09-28
---

# Strategies are archived, never deleted (#170, builds on 0032)

## Context

ADR-0032 capped strategies per user at 200 (`MAX_STRATEGIES_PER_USER`), but shipped no way past
it: nothing let a user retire a strategy. Strategy versions are immutable and backtest runs,
signals and journal decisions reference them (UBIQUITOUS_LANGUAGE.md "Strategy version"), so a
real delete would either cascade into that history or leave dangling references — either way it
contradicts the decision journal's own invariant that every AI analysis and decision stays visible
against its inputs (CLAUDE.md, principle 4). The owner decided (2026-09-28): archive, no delete.

## Decision

- A nullable `archived_at timestamptz` on `strategies` (migration 0025). `archive` sets it and
  also sets `active = false`: an archived strategy stops producing signals the same way any other
  deactivation does. `unarchive` clears it and never re-activates — the strategy comes back exactly
  as inactive as it was left.
- An archived strategy is:
  - excluded from `listMine` (a separate `listMineArchived` lists it) and from the per-user cap
    (`enforceStrategyCap` counts `archived_at is null` rows only, docs/adr/0032 addendum);
  - excluded from `listShared`/`findShared`/`copyShared` — an archived shared strategy is no
    longer offered to others, but its `visibility` value is kept, so unarchiving restores sharing
    with no separate re-share step;
  - excluded from `listActiveDaily` and `activeStrategyUserIds` (belt and braces: both filter
    `archived_at is null` even though archiving already sets `active = false`);
  - read-only: `addVersion`, `setActive(id, true)` and `setVisibility(id, "shared")` all refuse
    with `StrategyArchivedError`;
  - refused as the target of a new backtest run (`createBacktestRunAction` checks
    `strategy.archivedAt`) — existing runs, signals and decisions stay readable and untouched.
- `unarchive` takes the same per-user advisory lock and cap check as `createWithVersion` and
  `copyShared` (`enforceStrategyCap`, under `lockUserScope(tx, "strategies")`): unarchiving at 200
  non-archived strategies is refused with the same `StrategyLimitReachedError` a 201st create
  would get.
- `archive` is idempotent (re-archiving an already-archived strategy just re-stamps
  `archived_at`) and needs no confirmation dialog in the UI: it is reversible, unlike discarding a
  backtest run (docs/adr/0032's own residual, `DiscardRunButton`).
- `findMine` still returns an archived strategy, `archivedAt` populated, so its own page and
  version/run history stay reachable; only the editor, activation, sharing and "run backtest"
  controls are hidden there.

## Consequences

- The 200-strategy cap is no longer a hard wall: archiving is always available to make room,
  whether or not the strategy would otherwise still be useful.
- A strategy's own page is the only way to reach its history once archived and off the default
  list — acceptable, since the archived list on `/estrategias` links straight to it.
- No delete endpoint exists or is planned: the decision journal's requirement that every decision
  stay visible against its inputs would otherwise be at risk the moment a strategy a decision
  references could vanish.
