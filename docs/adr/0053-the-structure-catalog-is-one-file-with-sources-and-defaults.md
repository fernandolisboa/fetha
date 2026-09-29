---
status: accepted
date: 2026-09-29
---

# The structure catalog is one file, each entry with its source and default selection (#20)

## Context

The catalog (UBIQUITOUS_LANGUAGE.md "Catalog") held three structures written inline in
`apps/web/scripts/seed-structures.mjs`: the stock purchase, the collar and the bull call spread.
#20 asks for the structures a published source covers, Hull's _Options, Futures, and Other
Derivatives_ (chapter 12, "Trading Strategies Involving Options") and B3's own educational
material, each with its legs, a default strike and expiry selection, its reference and notes,
and a committed checklist of what was covered and what was left out.

## Decision

1. **One file.** `apps/web/src/modules/strategies/catalog.json` lists every entry: the structure
   (`structureSchema`), `defaults` (`strikes` by rank and an optional `expiry` window, the same
   shapes a strategy definition uses), `reference` and `notes`. `catalogSchema` in
   `packages/contracts` validates it; the app parses it on load, and a unit test checks that
   every entry's defaults make a writable strategy coherent with its structure.
2. **The seed script reads the file.** `seed-structures.mjs` upserts each entry's structure into
   `structures` as before (id, name, legs). An entry removed from the file stays in the table,
   because strategy versions reference it. No migration: defaults, reference and notes are not
   stored in the database, since only the app reads them and it ships with the file.
3. **A reference strategy is an entry's defaults.** The issue's "reference strategies" are read
   as a structure plus a starting strike and expiry selection, not as full strategies with entry
   and exit rules: those are the user's own choice, and a shared strategy (ADR-0012) already
   covers publishing one. The strategy editor starts a new strategy, and a change of structure,
   from the entry's defaults; the user edits them before saving.
4. **Defaults are this project's.** Strikes by moneyness (0% or ±5% of the spot, rising with the
   strike rank, so the engine's `degenerate_strikes` rule never refuses a default outright), and
   an expiry 15 to 45 business days out for structures that sell or spread premium, 20 to 60 for
   those that buy it. Neither source prescribes these.
5. **Only cited structures.** An entry names its source section; structures with two expiries
   (ADR-0014), a short underlying, two underlyings, or no source found for this pass are left
   out, each with its reason, in `docs/catalog.md`. A unit test fails when an entry is missing
   from that checklist.
6. **Existing ids stay.** `stock`, `collar` and `bull-call-spread` keep their ids, which
   strategy versions and contemplated operations reference; `bull-call-spread` is renamed
   "Trava de alta com calls" beside the new "Trava de alta com puts".

## Consequences

- Adding a structure is a data change: an entry in the JSON, a line in `docs/catalog.md`, and
  the seed that runs after every migration writes it.
- An end-to-end integration test backtests the seeded bull call spread from its catalog defaults
  to a settled operation.

## Considered options

- Columns on `structures` for defaults, reference and notes: one more migration for data only
  the app reads, and two places to keep in step.
- Full reference strategies (entry and exit rules) in the catalog: the sources define payoffs,
  not signals, so any rule would be invented and presented as a reference.
