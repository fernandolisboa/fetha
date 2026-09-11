import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { backtestRunSchema } from "@fetha/contracts";
import type { BacktestRun as EngineBacktestRun } from "@fetha/engine";

// ADR-0013 addendum "persisted engine artifacts" (#18 round 5 item 4):
// `packages/contracts` owns a second, parsing definition of the engine's
// own frozen `BacktestRun` (`backtestRunSchema`, mirrored by value because
// contracts cannot import from the engine — ADR-0013's ownership rule runs
// only one way). `backtest-run-repository.ts`'s
// `backtestRunSchema.parse(value) as unknown as BacktestRun` deliberately
// severs the compile-time link an ordinary cast would give for free, so
// nothing catches the two drifting apart at build time. `apps/web` is the
// one place both packages are visible (the same reasoning
// `enum-drift.test.ts` uses for the smaller enum mirrors): this pin fails
// typecheck the moment a field is added, removed, renamed or retyped on
// either side, instead of surfacing as a raw `ZodError` out of
// `getMyBacktestRunsForStrategy` — 500ing a whole strategy page — the first
// time a historical row reaches the drifted parser after a deploy.
//
// `config` is pinned here too (#18 round 6 item 2): it is mutually
// assignable between the two packages today and compiles clean both
// directions, so excluding it would have dropped the largest subtree of
// the artifact — `strategy`, `costModel`, `riskProfile`, `sizing`,
// `walkForward`, `period`, `universe`, `initialCapital`, `seed` — while
// `backtestConfigSchema` stays `z.strictObject`, exactly where drift is
// guaranteed to be fatal.
//
// `operations`, `notes` and `provenance` are excluded from the bidirectional
// check below and checked one-directionally instead, for two different
// reasons:
// - `operations` is not a Zod inference quirk: contracts' `legSettlementSchema`
//   is a flat `z.strictObject`, while the engine's own `LegSettlement`
//   correlates role, side and outcome into a proper discriminated union
//   (see `backtest-run-repository.ts`'s `asEngineRun`, which diagnoses this
//   correctly — this comment used to say "inference quirk" and was wrong).
//   The contract type is a strict superset shape, not a narrower one, so
//   only the engine-to-contract direction can hold.
// - `notes.code` and `provenance.pricingModel` are `z.string()`, not
//   mirrors of the engine's `NoteCode` (~24 members) and `PricingModel`
//   unions (tracked, not silently left: #91). Narrowing them to a two-way
//   pin would make a future engine-side member fail to parse until the
//   mirror catches up — the opposite failure this whole item exists to
//   close — so only the direction that catches an engine-side rename or
//   removal is checked.
type Pinned<T> = Omit<T, "operations" | "notes" | "provenance"> & {
  operations: unknown;
  notes: unknown;
  provenance: unknown;
};

type ContractRun = z.infer<typeof backtestRunSchema>;

type PinnedContract = Pinned<ContractRun>;
type PinnedEngine = Pinned<EngineBacktestRun>;

type EngineOperationsNotesProvenance = Pick<
  EngineBacktestRun,
  "operations" | "notes" | "provenance"
>;
type ContractOperationsNotesProvenance = Pick<ContractRun, "operations" | "notes" | "provenance">;

describe("backtestRunSchema mirrors the engine's own frozen BacktestRun shape", () => {
  it("type-checks identically to packages/engine's BacktestRun, config included (assertion is compile-time only)", () => {
    // Mutual `toExtend`, not `toEqualTypeOf`: Zod's own optionality
    // inference (`.nullable()` vs a hand-written `| null`) differs just
    // enough that the exact-shape check reports a mismatch with nothing
    // structurally missing on either side. Checked both directions, since
    // either alone would miss a field only present on the other side.
    expectTypeOf<PinnedContract>().toExtend<PinnedEngine>();
    expectTypeOf<PinnedEngine>().toExtend<PinnedContract>();
  });

  it("operations, notes and provenance: an engine-side value still satisfies the contract shape (one-directional; the contract is a deliberately looser superset)", () => {
    expectTypeOf<EngineOperationsNotesProvenance>().toExtend<ContractOperationsNotesProvenance>();
  });
});
