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
// `config` and `operations` are excluded for a Zod inference reason:
// `config` carries `strategy.definition.entry` (contracts' recursive
// `Condition` union, condition.ts) and `operations` carries
// `SimulatedOperation`, a `status`-discriminated union built from
// `z.intersection(...).or(...)` (backtest-report.ts). Zod's own inference
// for both produces a structurally-equivalent but not syntactically-
// identical type that `toEqualTypeOf` rejects for reasons unrelated to this
// pin's actual purpose — both already have their own explicit type
// annotations (`Condition`'s `z.ZodType<Condition>`; `SimulatedOperation`'s
// own engine-side type) pinning their shape independently.
//
// `notes` and `provenance` are excluded for a real, separate reason this
// pin surfaced: `noteSchema.code` and `provenanceSchema.pricingModel` are
// `z.string().min(1)`, not mirrors of the engine's own `NoteCode` (~24
// members) and `PricingModel` unions, so `backtestRunSchema` accepts any
// string in either today. Narrowing them carries its own regression risk (a
// future engine-side member the mirror has not caught up with would then
// fail to parse, the opposite failure this whole item exists to close) and
// is not one of the six acceptance criteria; left as a known, separately-
// flagged gap rather than silently tightened here.
//
// What remains pinned exactly: `BacktestRun`'s own top-level shape plus
// `BacktestMetrics`, `WalkForwardWindow`, `MissedEntry`,
// `SessionLimitBreach`, `MonthlyTax` and `SimulatedFill` — so a field added,
// removed, renamed or retyped there fails typecheck instead of surfacing as
// a raw `ZodError` on a historical row the first time it reaches the
// drifted parser after a deploy (#18 round 5 item 4).
type Pinned<T> = Omit<T, "config" | "operations" | "notes" | "provenance"> & {
  config: unknown;
  operations: unknown;
  notes: unknown;
  provenance: unknown;
};

type PinnedContract = Pinned<z.infer<typeof backtestRunSchema>>;
type PinnedEngine = Pinned<EngineBacktestRun>;

describe("backtestRunSchema mirrors the engine's own frozen BacktestRun shape", () => {
  it("type-checks identically to packages/engine's BacktestRun (assertion is compile-time only)", () => {
    // Mutual `toExtend`, not `toEqualTypeOf`: Zod's own optionality
    // inference (`.nullable()` vs a hand-written `| null`) differs just
    // enough that the exact-shape check reports a mismatch with nothing
    // structurally missing on either side. Checked both directions, since
    // either alone would miss a field only present on the other side.
    expectTypeOf<PinnedContract>().toExtend<PinnedEngine>();
    expectTypeOf<PinnedEngine>().toExtend<PinnedContract>();
  });
});
