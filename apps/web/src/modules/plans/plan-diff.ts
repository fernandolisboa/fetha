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

// Legs are matched by their position in the structure's own template (round 4 review item 3),
// never by role+side: two legs of the same role and side (a butterfly's own two buy-call wings)
// would otherwise collide on both a React key and this diff — the structure's shape never
// changes under an edit, only which listed ticker fills a given template slot does, and that
// slot is exactly the array position every snapshot here is already built in.
export function diffPlans(original: PlanSnapshot, edited: PlanSnapshot): PlanChange[] {
  const changes: PlanChange[] = [];
  if (original.lots !== edited.lots) {
    changes.push({ kind: "lots", from: original.lots, to: edited.lots });
  }
  edited.legs.forEach((editedLeg, index) => {
    const originalLeg = original.legs[index];
    if (originalLeg && originalLeg.ticker !== editedLeg.ticker) {
      changes.push({
        kind: "leg",
        role: editedLeg.role,
        side: editedLeg.side,
        from: originalLeg.ticker,
        to: editedLeg.ticker,
      });
    }
  });
  return changes;
}
