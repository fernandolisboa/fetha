import type {
  AnalysisOutputV2,
  Centavos,
  Confidence,
  ContemplatedLeg,
  SessionDate,
  ThesisClaim,
  AnalysisOutlookClaim,
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
import { analysisRequests, analysisResults } from "./schema";

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
  // An accepted AI analysis of the same operation, requested just before the
  // decision, whose outlook the same nightly run scores (docs/adr/0058).
  analysis: { requestedAt: Date; claim: AnalysisOutlookClaim; claimConfidence: Confidence };
}

export type SeedE2EDecisionResult =
  | { ok: true; id: string }
  | { ok: false; reason: "missing_stock_structure" }
  | { ok: false; reason: "e2e_not_available" };

// Backs the E2E-only `/api/e2e/seed-decision` route, and only that route:
// seeds a decision the nightly scoring job can pick up
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
  // before ever calling in here: defense in
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

  await seedAcceptedAnalysis(db, scopedUser, operation.id, input);

  return { ok: true, id: recorded.id };
}

// Written to the tables directly, not through `AnalysesRepository.reserve`:
// the request instant must be backdated to an already-ingested session, and
// no model is called. The outlook names facts this row really holds.
async function seedAcceptedAnalysis(
  db: Database,
  scopedUser: ScopedUser,
  operationId: string,
  input: SeedE2EDecisionInput,
): Promise<void> {
  const output: AnalysisOutputV2 = {
    thesis: `Análise semeada pelo fluxo E2E sobre ${input.underlying}.`,
    counterThesis: "Os fatos semeados não sustentam uma contratese.",
    keyRisks: ["Os fatos semeados são mínimos."],
    maxLoss: "Os fatos não mostram a perda máxima.",
    breakEvens: "Os fatos não mostram pontos de equilíbrio.",
    invalidation: ["Uma queda forte do ativo."],
    confidence: { level: "low", justification: "Fatos mínimos, semeados para teste." },
    inputsCited: ["underlying"],
    outlook: {
      instrumentFact: "underlying",
      direction: "above",
      levelFact: "pricing.spot",
      horizon: "one_week",
      likelihood: "likely",
    },
  };
  const [request] = await db
    .insert(analysisRequests)
    .values({
      userId: scopedUser.id,
      subjectKind: "contemplated_operation",
      subjectId: operationId,
      inputs: {
        subject: "contemplated_operation",
        facts: {
          session: input.session.split("-").reverse().join("/"),
          structure: "Compra de ação",
          underlying: input.underlying,
          pricing: { spot: "R$ 1,00" },
        },
      },
      promptVersion: "analysis@2",
      model: "claude-opus-5-5",
      requestedAt: input.analysis.requestedAt,
    })
    .returning({ id: analysisRequests.id });
  if (!request) {
    throw new Error("failed to seed the E2E analysis request");
  }
  await db.insert(analysisResults).values({
    userId: scopedUser.id,
    requestId: request.id,
    outcome: "accepted",
    output,
    model: "claude-opus-5-5",
    claim: input.analysis.claim,
    claimConfidence: input.analysis.claimConfidence,
    horizon: input.horizon,
    completedAt: input.analysis.requestedAt,
  });
}
