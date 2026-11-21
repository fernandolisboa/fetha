import { Decimal } from "decimal.js";
import type { ImpliedVolatilityLabel } from "@fetha/engine";
import type { DecimalString, IvRegime } from "@fetha/contracts";

// The regime a stated view's recipe is matched against (docs/adr/0064's "low" | "high" | "any"):
// a clear label is used as-is. Normal IV (or no reading at all) resolves deliberately rather
// than falling through to "any" and then to the catalog's first candidate — round 1 review
// item "normal IV": the reading's own rank places it nearer one regime's threshold than the
// other (>= 50, the midpoint between the "low" and "high" thresholds, prefers the high-regime
// recipe; below it prefers low). No rank at all (no reading) is the only case still left as
// "any", the catalog-order fallback `recipeForView` already has.
export function ivRegimeFromReading(
  label: ImpliedVolatilityLabel | null,
  ivRank: DecimalString | null,
): IvRegime {
  if (label === "low") return "low";
  if (label === "high") return "high";
  if (label === "normal" && ivRank !== null) {
    return new Decimal(ivRank).gte(50) ? "high" : "low";
  }
  return "any";
}

// The word the plan's own summary sentence names today's volatility by — distinct from
// `ivRegimeFromReading`'s catalog-matching value, which a normal reading resolves away from
// "any" (round 2 review): the summary still says "normal", not the regime the fallback chose.
export type IvDisplay = "low" | "high" | "normal" | "any";

export function ivDisplayFromLabel(label: ImpliedVolatilityLabel | null): IvDisplay {
  return label ?? "any";
}
