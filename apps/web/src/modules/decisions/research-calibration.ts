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
  // Ideas that expired without data to score them: shown, never averaged in.
  unscorable: number;
  claimed: number;
  held: number;
  // The engine's P&L of one lot averaged over the scored ideas, which does not grow with how often
  // the user asks; null with none scored.
  averagePnl: Centavos | null;
}

export type ResearchCalibration = ResearchVerdictLine[];

// The journal's "Pesquisas do Fetha" panel (docs/adr/0076): per verdict, how many ideas the
// engine scored, how many of those carried a claim it could judge and how many would have held
// had the user entered, and the average engine P&L of one lot. Counting and averaging only;
// every figure is the engine's. An unscorable row has no outcome and is counted apart.
export function researchCalibration(rows: readonly ResearchScoreRow[]): ResearchCalibration {
  return analysisVerdicts.map((verdict) => {
    const ofVerdict = rows.filter((row) => row.verdict === verdict);
    const scored = ofVerdict.filter((row) => row.pnlCentavos !== null);
    const total = scored.reduce((sum, row) => sum + (row.pnlCentavos ?? 0), 0);
    return {
      verdict,
      scored: scored.length,
      unscorable: ofVerdict.length - scored.length,
      claimed: scored.filter((row) => row.claimHeld !== null).length,
      held: scored.filter((row) => row.claimHeld === true).length,
      averagePnl:
        scored.length === 0 ? null : centavosSchema.parse(Math.round(total / scored.length)),
    };
  });
}

export interface DiscardedOutcome {
  count: number;
  amount: Centavos;
  sign: "gain" | "loss" | "flat";
}

// What the ideas Fetha discarded would have made per lot, once any of them is scored: the same
// figure as the verdict's row.
export function discardedOutcome(calibration: ResearchCalibration): DiscardedOutcome | null {
  const line = calibration.find((entry) => entry.verdict === "do_not_enter");
  if (!line || line.averagePnl === null) return null;
  return {
    count: line.scored,
    amount: centavosSchema.parse(Math.abs(line.averagePnl)),
    sign: line.averagePnl > 0 ? "gain" : line.averagePnl < 0 ? "loss" : "flat",
  };
}
