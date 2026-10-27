import {
  analysisVerdicts,
  centavosSchema,
  type AnalysisVerdictDecision,
  type Centavos,
} from "@fetha/contracts";

import type { ResearchScoreRow } from "./research-scores-repository";

export interface ResearchVerdictLine {
  verdict: AnalysisVerdictDecision;
  scored: number;
  claimed: number;
  held: number;
  pnl: Centavos;
}

export type ResearchCalibration = ResearchVerdictLine[];

// The journal's "Pesquisas do Fetha" panel (docs/adr/0076): per verdict, how many ideas the
// engine scored, how many of those carried a claim it could judge and how many held, and the
// summed engine P&L of one lot each. Counting only; every figure summed is the engine's. An
// unscorable row has no outcome and counts for nothing.
export function researchCalibration(rows: readonly ResearchScoreRow[]): ResearchCalibration {
  return analysisVerdicts.map((verdict) => {
    const scored = rows.filter((row) => row.verdict === verdict && row.pnlCentavos !== null);
    return {
      verdict,
      scored: scored.length,
      claimed: scored.filter((row) => row.claimHeld !== null).length,
      held: scored.filter((row) => row.claimHeld === true).length,
      pnl: centavosSchema.parse(scored.reduce((sum, row) => sum + (row.pnlCentavos ?? 0), 0)),
    };
  });
}

export interface DiscardedOutcome {
  count: number;
  amount: Centavos;
  sign: "gain" | "loss" | "flat";
}

// What the ideas Fetha discarded would have made, on average per lot, once any of them is scored.
export function discardedOutcome(calibration: ResearchCalibration): DiscardedOutcome | null {
  const line = calibration.find((entry) => entry.verdict === "do_not_enter");
  if (!line || line.scored === 0) return null;
  const perLot = Math.round(line.pnl / line.scored);
  return {
    count: line.scored,
    amount: centavosSchema.parse(Math.abs(perLot)),
    sign: perLot > 0 ? "gain" : perLot < 0 ? "loss" : "flat",
  };
}
