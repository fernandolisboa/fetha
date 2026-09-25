import type {
  Centavos,
  Confidence,
  ContemplatedLeg,
  SessionDate,
  ThesisClaim,
  Ticker,
} from "@fetha/contracts";

import type { Database } from "@/db/client";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { OperationsRepository, type SaveContemplatedOperationInput } from "@/modules/portfolio";
import { StructuresRepository } from "@/modules/strategies";

import { DecisionsRepository } from "./decisions-repository";
import type { DecisionInputs } from "./inputs";

const STOCK_STRUCTURE_ID = "stock";

export interface SeedE2EDecisionInput {
  underlying: Ticker;
  session: SessionDate;
  decidedAt: Date;
  horizon: SessionDate;
  legs: ContemplatedLeg[];
  netPremiumCentavos: Centavos;
  maxLossCentavos: Centavos | null;
  maxGainCentavos: Centavos | null;
  claim: ThesisClaim | null;
  confidence: Confidence;
  rationale: string;
}

export type SeedE2EDecisionResult =
  | { ok: true; id: string }
  | { ok: false; reason: "missing_stock_structure" }
  | { ok: false; reason: "e2e_not_available" };

// Backs the E2E-only `/api/e2e/seed-decision` route (#29 fix-web item 3),
// and only that route: seeds a decision the nightly scoring job can pick up
// on its very next run, with a `decidedAt` the route controls directly
// (`DecisionsRepository.record`'s own optional override) rather than
// `defaultNow()`, so the E2E flow scores against a fixed, already-ingested
// session instead of whatever the wall-clock date happens to be on the day
// the suite runs. Never inserts into `structures` itself — the catalog is
// shared reference data seeded once by `db:seed-structures`
// (docs/adr/0012) — a missing `stock` structure is a deploy-time gap this
// reports, not one this route papers over.
export async function seedE2EDecision(
  db: Database,
  scopedUser: ScopedUser,
  input: SeedE2EDecisionInput,
): Promise<SeedE2EDecisionResult> {
  // The same production/E2E_SECRET-configured check the route already runs
  // before ever calling in here (round 3 item 10, security): defense in
  // depth, so this module refuses on its own — before any write — even if
  // ever reached by a caller other than that one route.
  if (isProductionDeployment() || !readE2ESecret()) {
    return { ok: false, reason: "e2e_not_available" };
  }

  const catalog = await new StructuresRepository(db).listAll();
  const stock = catalog.find((structure) => structure.id === STOCK_STRUCTURE_ID);
  if (!stock) {
    return { ok: false, reason: "missing_stock_structure" };
  }

  const operationInput: SaveContemplatedOperationInput = {
    structureId: stock.id,
    underlying: input.underlying,
    legs: input.legs,
    session: input.session,
    netPremiumCentavos: input.netPremiumCentavos,
    maxLossCentavos: input.maxLossCentavos,
    maxGainCentavos: input.maxGainCentavos,
    breachedLimits: [],
  };
  const operationsRepository = new OperationsRepository(db, scopedUser);
  const operation = await operationsRepository.save(operationInput);

  const decisionInputs: DecisionInputs = {
    originKind: "contemplated_operation",
    underlying: input.underlying,
    structureId: stock.id,
    structureName: stock.name,
    legs: input.legs,
    session: input.session,
    netPremiumCentavos: input.netPremiumCentavos,
    maxLossCentavos: input.maxLossCentavos,
    maxGainCentavos: input.maxGainCentavos,
    breachedLimits: [],
  };

  const decisionsRepository = new DecisionsRepository(db, scopedUser);
  const recorded = await decisionsRepository.record({
    kind: "do_not_enter",
    originKind: "contemplated_operation",
    signalId: null,
    contemplatedOperationId: operation.id,
    strategyVersionId: null,
    inputs: decisionInputs,
    rationale: input.rationale,
    claim: input.claim,
    confidence: input.confidence,
    horizon: input.horizon,
    costModel: DEFAULT_COST_MODEL,
    decidedAt: input.decidedAt,
  });

  return { ok: true, id: recorded.id };
}
