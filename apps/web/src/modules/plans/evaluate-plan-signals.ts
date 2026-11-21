import { centavosSchema, sessionDateSchema, type Centavos } from "@fetha/contracts";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { tradingSessionForDate } from "@/modules/market-data";
import { loadPortfolio, type OperationRow } from "@/modules/portfolio";

import { executedPlanUserIds } from "./executed-plan-users";
import { firedPlanSignalKinds, planSignalKinds, type PlanSignalKind } from "./plan-signal-rules";
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

// Price- and max-loss-based notes the engine attaches when today's mark pricing cannot be
// trusted (review round 2, #381): `unrealizedPnl` itself is still derived from this pricing, so
// a target or stop measured against it would be comparing against a number the engine itself
// flagged as unreliable.
const UNRELIABLE_MARK_NOTE_CODES = new Set(["no_market_price", "iv_not_converged"]);

const PRICE_BASED_KINDS: readonly PlanSignalKind[] = ["target_hit", "stop_hit"];

// Target and stop are entry-priced (review round 2, #381; see `plan-signal-rules.ts`'s own
// comment for why): resolved from `row.entryPayoff`'s own `priceOperation` call at each leg's
// `entryPrice`, never from today's mark. Skipped — not fired, not cleared — when the engine has
// no reliable entry price (`entryPayoff.kind !== "priced"`) or no reliable mark to compare it
// against (a `no_market_price`/`iv_not_converged` note on today's pricing); roll and expiry
// alerts need no price at all, so they are evaluated regardless.
const ZERO_CENTAVOS = centavosSchema.parse(0);

function priceBasesOf(
  row: OperationRow,
): { premiumBaseCentavos: Centavos; maxLossBaseCentavos: Centavos | "unbounded" } | null {
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
        if (!row || row.operation.status !== "open" || row.pendingSettlement || !row.valuation) {
          continue;
        }
        const priceBases = priceBasesOf(row);
        const evaluatedKinds = priceBases
          ? planSignalKinds
          : planSignalKinds.filter((kind) => !PRICE_BASED_KINDS.includes(kind));
        const kinds = firedPlanSignalKinds({
          premiumBaseCentavos: priceBases?.premiumBaseCentavos ?? ZERO_CENTAVOS,
          maxLossBaseCentavos: priceBases?.maxLossBaseCentavos ?? ZERO_CENTAVOS,
          unrealizedPnlCentavos: row.valuation.unrealizedPnl,
          exitRules: priceBases
            ? plan.rules.exitRules
            : plan.rules.exitRules.filter((rule) => rule.rule.kind === "days_before_expiry"),
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
