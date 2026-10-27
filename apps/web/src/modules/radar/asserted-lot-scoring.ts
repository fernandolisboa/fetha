import { confidenceSchema, type Instant, type ThesisClaim } from "@fetha/contracts";
import type { Engine, Operation, Score, TradingSession } from "@fetha/engine";

import type { Database } from "@/db/client";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { buildOperationMarketView } from "@/modules/market-data";

// A suggestion or a research idea states its claim without a likelihood (docs/adr/0067,
// docs/adr/0076): the engine scores it as a certain call, so the journal reads its hit rate and
// P&L, never a Brier.
const ASSERTED = confidenceSchema.parse("1");

// The nightly retry window of every scorer (docs/adr/0014): missing data this many sessions after
// the horizon is a permanent gap.
export const INSUFFICIENT_DATA_RETRY_SESSIONS = 5;

export interface AssertedScoreFields {
  claimHeld: boolean | null;
  pnlCentavos: number | null;
  maxLossCentavos: number | null;
  normalizedPnl: string | null;
  engineVersion: string;
}

export function assertedScoreFields(score: Score): AssertedScoreFields {
  return {
    claimHeld: score.thesis.claim === null ? null : score.thesis.held,
    pnlCentavos: score.pnl,
    maxLossCentavos: score.maxLoss === null || score.maxLoss === "unbounded" ? null : score.maxLoss,
    normalizedPnl: score.normalizedPnl,
    engineVersion: score.provenance.engineVersion,
  };
}

// Scores one priced lot as an entry asserted at `decidedAt`, held to `horizon` with no fills,
// the B3 default cost model and no strategy behind it.
export async function scoreAssertedLot(
  db: Database,
  engine: Pick<Engine, "score">,
  input: {
    operation: Operation;
    decidedAt: Instant;
    horizon: TradingSession;
    claim: ThesisClaim;
  },
): ReturnType<Engine["score"]> {
  const view = await buildOperationMarketView(db, input.operation.underlying, input.horizon.close, {
    from: input.decidedAt,
  });
  return engine.score({
    view,
    subject: "enter",
    decidedAt: input.decidedAt,
    horizon: input.horizon.date,
    confidence: ASSERTED,
    claim: input.claim,
    operation: input.operation,
    realizedFills: [],
    origin: { kind: "manual" },
    costModel: DEFAULT_COST_MODEL,
  });
}
