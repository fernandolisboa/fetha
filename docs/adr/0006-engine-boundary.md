---
status: accepted
date: 2026-09-02
---

# The engine is a pure package with a frozen public interface

`packages/engine` contains every computation Fetha shows (indicators, pricing, greeks, payoff,
backtests, risk metrics, scoring) as pure TypeScript: zero I/O, zero framework imports,
deterministic for its inputs, seeded randomness only. The web app and the AI layer consume its
public interface only, designed twice and frozen by a later ADR (Phase 2); nothing outside the
package may import its internals. This isolates the seam most likely to be optimized or replaced
(a faster implementation, a worker, a different language) and makes property-based testing and
the 95% coverage gate meaningful. Data adapters, persistence and prompts live in `apps/web`;
Zod contracts shared by both live in `packages/contracts`.
