import { Decimal } from "decimal.js";
import type { Centavos, ResolvedExitRule, RollRule, SessionDate } from "@fetha/contracts";

// Nightly alerts for a plan-linked operation (docs/adr/0079 addendum, ticket #381): every number
// here is already engine-computed (`OperationValuation.pricing`/`unrealizedPnl`, CLAUDE.md
// principle 1 — AI never produces numbers, and this module invents none either, it only compares
// two of the engine's own outputs). The formula mirrors the engine's own exit-rule evaluation
// (`packages/engine/src/internal/evaluate-strategy.ts`'s `evaluateNumericExitRule`) without
// depending on that internal: `premiumBase` is the absolute entry-priced net premium, `maxLossBase`
// falls back to it when the structure's max loss is unbounded, and the comparison direction is the
// same — a profit target fires once the unrealized P&L clears a fraction of the premium, a stop
// fires once it falls below a negative multiple of the max loss.
export const planSignalKinds = ["target_hit", "stop_hit", "roll_due"] as const;
export type PlanSignalKind = (typeof planSignalKinds)[number];

export interface PlanSignalInputs {
  netPremiumCentavos: Centavos;
  maxLossCentavos: Centavos | "unbounded";
  unrealizedPnlCentavos: Centavos;
  exitRules: readonly ResolvedExitRule[];
  roll: RollRule;
  todaySession: SessionDate;
}

function profitTargetFires(pnl: Decimal, premiumBase: Decimal, fractionOfPremium: string): boolean {
  if (premiumBase.lte(0)) return false;
  return pnl.gte(premiumBase.mul(fractionOfPremium));
}

function stopLossFires(pnl: Decimal, maxLossBase: Decimal, multipleOfMaxLoss: string): boolean {
  if (maxLossBase.lte(0)) return false;
  return pnl.lte(maxLossBase.mul(multipleOfMaxLoss).neg());
}

function rollDueFires(roll: RollRule, todaySession: SessionDate): boolean {
  return roll.applies && roll.session !== null && todaySession >= roll.session;
}

// Every kind this plan-linked operation's rules fire today, deduplicated within the call (a
// recipe with two `stop_loss` rules reports `stop_hit` once); the caller (`evaluate-plan-
// signals.ts`) is the one that deduplicates across nights, via the unique index on
// `(user, operation, kind)`.
export function firedPlanSignalKinds(inputs: PlanSignalInputs): PlanSignalKind[] {
  const pnl = new Decimal(inputs.unrealizedPnlCentavos);
  const premiumBase = new Decimal(Math.abs(inputs.netPremiumCentavos));
  const maxLossBase =
    inputs.maxLossCentavos === "unbounded" ? premiumBase : new Decimal(inputs.maxLossCentavos);

  const kinds = new Set<PlanSignalKind>();
  for (const resolved of inputs.exitRules) {
    if (resolved.rule.kind === "profit_target") {
      if (profitTargetFires(pnl, premiumBase, resolved.rule.fractionOfPremium)) {
        kinds.add("target_hit");
      }
    } else if (resolved.rule.kind === "stop_loss") {
      if (stopLossFires(pnl, maxLossBase, resolved.rule.multipleOfMaxLoss)) {
        kinds.add("stop_hit");
      }
    }
  }
  if (rollDueFires(inputs.roll, inputs.todaySession)) {
    kinds.add("roll_due");
  }
  return [...kinds];
}
