---
status: accepted
date: 2026-09-02
---

# Strategies are declarative JSON with a closed vocabulary, never code

A strategy version is a JSON document validated by a Zod schema in `packages/contracts` and
interpreted by the engine. It declares a timeframe (`15m`, `30m`, `60m`, `D1`); entry conditions
as an expression tree over named indicators and price fields (`close > sma(20)`,
`rsi(14) < 30`, `iv_rank > 50`) combined with and/or/not; the structure to enter from the
catalog; strike selection by delta, by moneyness or by nearest strike to a price; expiry
selection by a business-day window; a sizing rule; exit rules (profit target as a fraction of
the credit or debit, stop as a fraction or a multiple of max loss, N business days before expiry,
or a condition); and adjustment rules. New indicators are added as engine code with tests, never
as expressions in the JSON. When no option series satisfies the selection rules there is no
signal and the reason is recorded. Versions are immutable and referenced by backtests, signals
and decisions.

The v1 editor UI (`apps/web/src/modules/strategies/editor/`) renders only a subset of this
vocabulary as rows: for the entry condition, a single `compare` condition or a flat `and` of
`compare` conditions, each as its own row (`compare-conditions.ts`'s
`toEditableEntry`/`fromEditableEntry`); for a `condition` exit rule, a single `compare` condition
only (`toEditableExitCondition`/`fromEditableExitCondition`) — an exit's flat `and` of two or more
compares is not rendered as rows. Any shape the entry or exit editor cannot represent — `or`,
`not`, an `and` that nests another `and`/`or`/`not`, or (for an exit) any `and` at all — is not
editable in this UI: it is shown as a read-only notice and kept byte-for-byte unchanged on save,
never silently replaced by a default row or truncated to its first compare. A strategy built
outside this editor (a hand-authored catalog entry, a future API) with such a condition still
round-trips through the contracts schema and the engine; it just cannot be edited visually
until the editor grows a recursive tree builder.

## Considered options

- Strategies as TypeScript functions: maximal expressiveness, but not diffable, not safely
  shareable between users, not versionable as data, and a code-execution surface.
- A free-form expression language: more power than the first structures need, harder to
  validate and to backtest by property.
