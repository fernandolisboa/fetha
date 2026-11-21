import { Decimal } from "decimal.js";
import type { Centavos, ExitRule, ResolvedExitRule, RollRule, SessionDate } from "@fetha/contracts";

// Nightly alerts for a plan-linked operation (docs/adr/0079 addendum, ticket #381): every number
// here is already engine-computed — `premiumBaseCentavos`/`maxLossBaseCentavos` are the entry
// side of `EntryPayoff.pricing` (`engine.priceOperation` priced at each leg's own `entryPrice`,
// `apps/web/src/modules/portfolio/entry-payoff.ts`), `unrealizedPnlCentavos` is
// `OperationValuation.unrealizedPnl` (CLAUDE.md principle 1 — this module invents no number, it
// only compares two of the engine's own outputs).
//
// The bases are entry-priced on purpose, mirroring `computeExitRuleBases` in the engine's own
// `packages/engine/src/internal/evaluate-strategy.ts` (not imported — ADR-0013's frozen
// interface — only matched): a target or stop measured against *today's* mark-priced premium or
// max loss would drift as the position itself moves, so a short option's stop could reach a
// multiple of 1 and never fire, and a profit target could fire at the wrong fraction entirely
// (review round 2, #381). `evaluate-plan-signals.ts` is the one place that resolves these bases
// and skips target/stop entirely when the engine has no reliable entry price to resolve them
// from (`EntryPayoff.kind !== "priced"`, or the mark pricing itself carries a `no_market_price` /
// `iv_not_converged` note) — roll and expiry alerts need no price at all, so they are never
// skipped.
export const planSignalKinds = ["target_hit", "stop_hit", "roll_due", "expiry_near"] as const;
export type PlanSignalKind = (typeof planSignalKinds)[number];

export interface PlanSignalInputs {
  premiumBaseCentavos: Centavos;
  maxLossBaseCentavos: Centavos | "unbounded";
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

function sessionReached(target: SessionDate | null, todaySession: SessionDate): boolean {
  return target !== null && todaySession >= target;
}

function rollDueFires(roll: RollRule, todaySession: SessionDate): boolean {
  return roll.applies && sessionReached(roll.session, todaySession);
}

// Every `ExitRule` kind, exhaustively (review round 2, #381): a reached `days_before_expiry`
// resolves to `expiry_near`, never silently dropped. `condition` exit rules evaluate an
// indicator-based `Condition` the engine's own backtester reads off a candle series; this
// nightly step only has the operation's own mark and entry pricing to work with, no indicator
// evaluation, so a `condition` rule never fires here — a future ticket that wires indicator
// evaluation into this step is the one to change this, not a silent gap today.
function kindOf(
  rule: ExitRule,
  resolved: ResolvedExitRule,
  pnl: Decimal,
  premiumBase: Decimal,
  maxLossBase: Decimal,
  todaySession: SessionDate,
): PlanSignalKind | null {
  switch (rule.kind) {
    case "profit_target":
      return profitTargetFires(pnl, premiumBase, rule.fractionOfPremium) ? "target_hit" : null;
    case "stop_loss":
      return stopLossFires(pnl, maxLossBase, rule.multipleOfMaxLoss) ? "stop_hit" : null;
    case "days_before_expiry":
      return sessionReached(resolved.session, todaySession) ? "expiry_near" : null;
    case "condition":
      return null;
  }
}

// Every kind this plan-linked operation's rules fire today, deduplicated within the call (a
// recipe with two `stop_loss` rules reports `stop_hit` once); the caller (`evaluate-plan-
// signals.ts`) is the one that deduplicates across nights, via the unique index on
// `(user, operation, kind)`.
export function firedPlanSignalKinds(inputs: PlanSignalInputs): PlanSignalKind[] {
  const pnl = new Decimal(inputs.unrealizedPnlCentavos);
  const premiumBase = new Decimal(Math.abs(inputs.premiumBaseCentavos));
  const maxLossBase =
    inputs.maxLossBaseCentavos === "unbounded"
      ? premiumBase
      : new Decimal(inputs.maxLossBaseCentavos);

  const kinds = new Set<PlanSignalKind>();
  for (const resolved of inputs.exitRules) {
    const kind = kindOf(
      resolved.rule,
      resolved,
      pnl,
      premiumBase,
      maxLossBase,
      inputs.todaySession,
    );
    if (kind) kinds.add(kind);
  }
  if (rollDueFires(inputs.roll, inputs.todaySession)) {
    kinds.add("roll_due");
  }
  return [...kinds];
}
