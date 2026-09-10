import type { StrategyDefinition } from "./strategy-definition";
import type { Structure } from "./structure";

export type StrategyCoherenceResult = { ok: true } | { ok: false; path: string; message: string };

// Mirrors `validateCoherence` in `packages/engine/src/internal/evaluate-strategy.ts`.
// ADR-0013: the engine may import this package's types only, and this package
// may not import the engine, so the rule set is two independent
// implementations by necessity — not a shortcut. Whoever edits one must edit
// the other and add a fixture to
// `apps/web/src/modules/strategies/coherence-conformance.test.ts`, which runs
// both over the same matrix and fails the day they drift.
export function checkStrategyCoherence(
  definition: StrategyDefinition,
  structure: Structure,
): StrategyCoherenceResult {
  if (definition.structureId !== structure.id) {
    return {
      ok: false,
      path: "structureId",
      message: "definition.structureId must match structure.id",
    };
  }

  const hasOptionLegs = structure.legs.some((leg) => leg.role !== "stock");
  if (!hasOptionLegs) {
    if (definition.strikes.length > 0) {
      return {
        ok: false,
        path: "strikes",
        message: "a stock-only structure cannot select strikes",
      };
    }
    if (definition.expiry !== undefined) {
      return {
        ok: false,
        path: "expiry",
        message: "a stock-only structure has no expiry to select",
      };
    }
    if (definition.exit.some((rule) => rule.kind === "days_before_expiry")) {
      return {
        ok: false,
        path: "exit",
        message: "days_before_expiry is meaningless for a stock-only structure",
      };
    }
    if (definition.adjustments.length > 0) {
      return {
        ok: false,
        path: "adjustments",
        message: "roll is meaningless for a stock-only structure",
      };
    }
    return { ok: true };
  }

  if (definition.expiry === undefined) {
    return {
      ok: false,
      path: "expiry",
      message: "a structure with option legs requires an expiry selection",
    };
  }

  const distinctRanks = new Set(
    structure.legs.filter((leg) => leg.role !== "stock").map((leg) => leg.strikeRank),
  ).size;
  if (definition.strikes.length !== distinctRanks) {
    return {
      ok: false,
      path: "strikes",
      message: "strikes.length must equal the number of distinct strike ranks",
    };
  }

  return { ok: true };
}
