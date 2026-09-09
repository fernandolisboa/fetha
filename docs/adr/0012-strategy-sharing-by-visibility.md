---
status: accepted
date: 2026-09-08
---

# Strategies are shared by visibility, read-only, copy to use; nothing else is shared

A strategy has visibility `private` or `shared`. A shared strategy is visible, read-only, to every
registered user together with the backtest metrics its owner chose to publish; another user
copies it into their own space to run or change it, and versions diverge from there. There is no
sharing by invitation, no comments, and no sharing of operations, decisions, analyses,
portfolios or risk profiles, which stay strictly private. This keeps the tenant-isolation
invariant simple (one more read-only exception, like the catalog) while letting the owner and
friends exchange strategies.

## Considered options

- Per-person sharing (grants): more control, more tables and more isolation tests for a feature
  used by a handful of people.
- Shared workspaces: rejected by the kickoff; the tenant is the user account.
