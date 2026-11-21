import { Decimal } from "decimal.js";
import type { DecimalString } from "@fetha/contracts";

// Drag-to-adjust's own snapping rule (ticket #380): a dragged handle always lands on a real,
// traded strike of the chain, never a free-floating price nothing is listed at. `candidates` is
// expected to already be narrowed to one option right and expiry, and to traded-only strikes
// (`PlanChainEntry.traded`) — an untraded strike is dimmed, never a snap target, by the caller
// filtering it out before calling this, not by this function silently preferring a traded
// neighbour. Ties (the target sits exactly between two strikes) resolve to the lower one, the
// same side `Decimal`'s own `ROUND_HALF_FLOOR` would — deterministic for a fixed input rather
// than left to array order.
export function snapToStrike(
  candidates: readonly DecimalString[],
  target: number,
): DecimalString | null {
  const [first, ...rest] = candidates;
  if (first === undefined) return null;
  let best = first;
  let bestDistance = new Decimal(best).minus(target).abs();
  for (const candidate of rest) {
    const distance = new Decimal(candidate).minus(target).abs();
    if (
      distance.lt(bestDistance) ||
      (distance.eq(bestDistance) && new Decimal(candidate).lt(best))
    ) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
