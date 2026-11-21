import { sessionDateSchema } from "@fetha/contracts";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { tradingSessionForDate } from "@/modules/market-data";
import { loadPortfolio, type OperationRow } from "@/modules/portfolio";

import { executedPlanUserIds } from "./executed-plan-users";
import {
  evaluatedPlanSignalKinds,
  firedPlanSignalKinds,
  planSignalKinds,
  type PriceBases,
} from "./plan-signal-rules";
import { PlanRulesRepository } from "./plan-rules-repository";
import { PlanSignalsRepository, type NewPlanSignal } from "./plan-signals-repository";

export interface EvaluatePlanSignalsOutcome {
  usersEvaluated: number;
  usersSkipped: number;
  signalsWritten: number;
  signalsCleared: number;
  errors: number;
}

export interface EvaluatePlanSignalsOptions {
  // Same shape as `evaluateSignalsForSession`'s own deadline (CLAUDE.md: this step must be
  // skippable and reported like its siblings, never the one that blows past the nightly budget).
  deadlineAt?: number;
  now?: () => number;
}

function emptyOutcome(): EvaluatePlanSignalsOutcome {
  return { usersEvaluated: 0, usersSkipped: 0, signalsWritten: 0, signalsCleared: 0, errors: 0 };
}

// The only note that means today's mark itself is unusable (#381 round 3): `no_market_price`.
// `iv_not_converged` fires when a leg has a market price but no greeks — a deep-ITM short priced
// below intrinsic, for example — and the engine's own `evaluateNumericExitRule` still treats that
// mark and the `unrealizedPnl` derived from it as valid, so it must not be in this skip set.
const UNRELIABLE_MARK_NOTE_CODES = new Set(["no_market_price"]);

// Target and stop are entry-priced (#381; see `plan-signal-rules.ts`'s own comment for why):
// resolved from `row.entryPayoff`'s own `priceOperation` call at each leg's `entryPrice`, never
// from today's mark. Null — and so skipped, not fired, not cleared, by `plan-signal-rules.ts`
// itself — when the engine has no reliable entry price (`entryPayoff.kind !== "priced"`) or no
// reliable mark at all (a `no_market_price` note on today's pricing).
function priceBasesOf(row: OperationRow): PriceBases | null {
  if (row.entryPayoff.kind !== "priced") return null;
  if (!row.valuation) return null;
  if (row.valuation.pricing.notes.some((note) => UNRELIABLE_MARK_NOTE_CODES.has(note.code))) {
    return null;
  }
  return {
    premiumBaseCentavos: row.entryPayoff.pricing.netPremium,
    maxLossBaseCentavos: row.entryPayoff.pricing.maxLoss,
  };
}

// Chained after decision scoring, on the same as-of session (ticket #381): for every open,
// not-pending-settlement operation an executed plan is linked to, checks the plan's own rules
// against the engine's own entry and mark pricing (CLAUDE.md principle 1 — this function invents
// no number, it only compares the engine's own outputs) and writes whichever of target hit, stop
// hit, roll due or expiry near just became true, clearing any of those kinds that no longer fire.
// Never sends an order (ADR-0079/#381): the user still acts on it from the Carteira.
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
  let signalsCleared = 0;
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
      const signalsRepo = new PlanSignalsRepository(db, scopedUser);
      if (plans.length === 0) {
        usersEvaluated += 1;
        continue;
      }
      const rowByOperationId = new Map(portfolio.operations.map((row) => [row.operation.id, row]));
      const newSignals: NewPlanSignal[] = [];
      for (const plan of plans) {
        const operationId = plan.operationId;
        if (!operationId) continue;
        const row = rowByOperationId.get(operationId);
        // A position the user no longer holds — settled, rolled away, or still open but
        // pending its own settlement and not mark-to-market'd — clears every alert kind for it
        // rather than leaving a stale target_hit/stop_hit/roll_due/expiry_near on `/sinais`
        // forever (round 2 correctness finding, #381): nothing about it can still be firing.
        if (!row || row.operation.status !== "open" || row.pendingSettlement || !row.valuation) {
          signalsCleared += await signalsRepo.clearStale(operationId, planSignalKinds, []);
          continue;
        }
        const priceBases = priceBasesOf(row);
        const evaluatedKinds = evaluatedPlanSignalKinds(priceBases);
        const kinds = firedPlanSignalKinds({
          priceBases,
          unrealizedPnlCentavos: row.valuation.unrealizedPnl,
          exitRules: plan.rules.exitRules,
          roll: plan.rules.roll,
          todaySession: session,
        });
        for (const kind of kinds) {
          newSignals.push({ operationPlanRulesId: plan.id, operationId, kind, session, at });
        }
        signalsCleared += await signalsRepo.clearStale(operationId, evaluatedKinds, kinds);
      }
      if (newSignals.length > 0) {
        signalsWritten += await signalsRepo.createMany(newSignals);
      }
      usersEvaluated += 1;
    } catch {
      errors += 1;
    }
  }

  return { usersEvaluated, usersSkipped, signalsWritten, signalsCleared, errors };
}
