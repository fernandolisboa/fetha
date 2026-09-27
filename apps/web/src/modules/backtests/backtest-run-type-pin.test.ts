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
// `operations` is excluded from the bidirectional check below and checked
// one-directionally (engine → contract) instead: contracts'
// `legSettlementSchema` is a flat `z.strictObject`, while the engine's own
// `LegSettlement` correlates role, side and outcome into a proper
// discriminated union (see `backtest-run-repository.ts`'s `asEngineRun`).
// That direction catches a field renamed or removed on the engine side, not
// one added; an engine-side addition is caught at runtime by
// `run-chunk.integration.test.ts`'s round-trip of a completed run's `result`
// through the real schema. `notes` and `provenance` are pinned both ways:
// their vocabularies mirror the engine's by value (#91), guarded by
// `enum-drift.test.ts`.
type Pinned<T> = Omit<T, "operations"> & { operations: unknown };

type ContractRun = z.infer<typeof backtestRunSchema>;

type PinnedContract = Pinned<ContractRun>;
type PinnedEngine = Pinned<EngineBacktestRun>;

type EngineOperations = Pick<EngineBacktestRun, "operations">;
type ContractOperations = Pick<ContractRun, "operations">;

describe("backtestRunSchema mirrors the engine's own frozen BacktestRun shape", () => {
  it("type-checks identically to packages/engine's BacktestRun, config, notes and provenance included (assertion is compile-time only)", () => {
    // Mutual `toExtend`, not `toEqualTypeOf`: Zod's own optionality
    // inference (`.nullable()` vs a hand-written `| null`) differs just
    // enough that the exact-shape check reports a mismatch with nothing
    // structurally missing on either side. Checked both directions, since
    // either alone would miss a field only present on the other side.
    expectTypeOf<PinnedContract>().toExtend<PinnedEngine>();
    expectTypeOf<PinnedEngine>().toExtend<PinnedContract>();
  });

  it("operations: an engine-side value still satisfies the contract shape (one-directional; catches a rename or removal, not an addition)", () => {
    expectTypeOf<EngineOperations>().toExtend<ContractOperations>();
  });
});
