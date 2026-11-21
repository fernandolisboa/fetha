import type { Ticker } from "@fetha/contracts";
import type { LegRole, Side } from "@fetha/engine";

// "O que mudou" (ticket #380): a plain diff of what the user touched relative to Fetha's own
// plan, read off two snapshots built the same way — never diffed by re-deriving numbers of its
// own (CLAUDE.md principle 1, every number here already came from the engine before this runs).
export interface PlanDiffLeg {
  role: LegRole;
  side: Side;
  ticker: Ticker;
}

export interface PlanSnapshot {
  lots: number;
  legs: readonly PlanDiffLeg[];
}

export type PlanChange =
  | { kind: "lots"; from: number; to: number }
  | { kind: "leg"; role: LegRole; side: Side; from: Ticker; to: Ticker };

// Legs are matched by role+side, not by array position: the structure's own shape (which role
// and side exist) never changes under an edit, only which listed ticker fills a given slot does.
export function diffPlans(original: PlanSnapshot, edited: PlanSnapshot): PlanChange[] {
  const changes: PlanChange[] = [];
  if (original.lots !== edited.lots) {
    changes.push({ kind: "lots", from: original.lots, to: edited.lots });
  }
  for (const editedLeg of edited.legs) {
    const originalLeg = original.legs.find(
      (leg) => leg.role === editedLeg.role && leg.side === editedLeg.side,
    );
    if (originalLeg && originalLeg.ticker !== editedLeg.ticker) {
      changes.push({
        kind: "leg",
        role: editedLeg.role,
        side: editedLeg.side,
        from: originalLeg.ticker,
        to: editedLeg.ticker,
      });
    }
  }
  return changes;
}
