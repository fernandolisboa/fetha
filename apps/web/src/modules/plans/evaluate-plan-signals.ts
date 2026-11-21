import { sessionDateSchema } from "@fetha/contracts";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { tradingSessionForDate } from "@/modules/market-data";
import { loadPortfolio } from "@/modules/portfolio";

import { executedPlanUserIds } from "./executed-plan-users";
import { firedPlanSignalKinds } from "./plan-signal-rules";
import { PlanRulesRepository } from "./plan-rules-repository";
import { PlanSignalsRepository, type NewPlanSignal } from "./plan-signals-repository";

export interface EvaluatePlanSignalsOutcome {
  usersEvaluated: number;
  usersSkipped: number;
  signalsWritten: number;
  errors: number;
}

export interface EvaluatePlanSignalsOptions {
  // Same shape as `evaluateSignalsForSession`'s own deadline (CLAUDE.md: this step must be
  // skippable and reported like its siblings, never the one that blows past the nightly budget).
  deadlineAt?: number;
  now?: () => number;
}

function emptyOutcome(): EvaluatePlanSignalsOutcome {
  return { usersEvaluated: 0, usersSkipped: 0, signalsWritten: 0, errors: 0 };
}

// Chained after decision scoring, on the same as-of session (ticket #381): for every open,
// not-pending-settlement operation an executed plan is linked to, checks the plan's own rules
// against the engine's own mark (`loadPortfolio`'s `OperationValuation`, CLAUDE.md principle 1 —
// this function invents no number, it only compares the engine's own `pricing`/`unrealizedPnl`
// through `firedPlanSignalKinds`) and writes whichever of target hit, stop hit or roll due just
// became true. Never sends an order (ADR-0079/#381): the user still acts on it from the Carteira.
export async function evaluatePlanSignals(
  db: Database,
  asOfSession: string,
  options: EvaluatePlanSignalsOptions = {},
): Promise<EvaluatePlanSignalsOutcome> {
  const sessionParsed = sessionDateSchema.safeParse(asOfSession);
  if (!sessionParsed.success) return emptyOutcome();
  const session = sessionParsed.data;

  const trading = await tradingSessionForDate(db, session);
  if (!trading) return emptyOutcome();
  const at = trading.close;
  const now = options.now ?? Date.now;

  const userIds = await executedPlanUserIds(db);

  let usersEvaluated = 0;
  let usersSkipped = 0;
  let signalsWritten = 0;
  let errors = 0;

  for (const userId of userIds) {
    if (options.deadlineAt !== undefined && now() >= options.deadlineAt) {
      usersSkipped += 1;
      continue;
    }
    const scopedUser: ScopedUser = { id: userId };
    try {
      const portfolio = await loadPortfolio(db, scopedUser, at);
      const operationIds = portfolio.operations.map((row) => row.operation.id);
      const plans = await new PlanRulesRepository(db, scopedUser).listByOperations(operationIds);
      if (plans.length === 0) {
        continue;
      }
      const rowByOperationId = new Map(portfolio.operations.map((row) => [row.operation.id, row]));
      const newSignals: NewPlanSignal[] = [];
      for (const plan of plans) {
        const operationId = plan.operationId;
        if (!operationId) continue;
        const row = rowByOperationId.get(operationId);
        if (!row || row.operation.status !== "open" || row.pendingSettlement || !row.valuation) {
          continue;
        }
        const kinds = firedPlanSignalKinds({
          netPremiumCentavos: row.valuation.pricing.netPremium,
          maxLossCentavos: row.valuation.pricing.maxLoss,
          unrealizedPnlCentavos: row.valuation.unrealizedPnl,
          exitRules: plan.rules.exitRules,
          roll: plan.rules.roll,
          todaySession: session,
        });
        for (const kind of kinds) {
          newSignals.push({ operationPlanRulesId: plan.id, operationId, kind, session, at });
        }
      }
      if (newSignals.length > 0) {
        signalsWritten += await new PlanSignalsRepository(db, scopedUser).createMany(newSignals);
      }
      usersEvaluated += 1;
    } catch {
      errors += 1;
    }
  }

  return { usersEvaluated, usersSkipped, signalsWritten, errors };
}
