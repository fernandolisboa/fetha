import type { ImpliedVolatilityLabel } from "@fetha/engine";
import type { IvRegime } from "@fetha/contracts";

// The recipe book's IvRegime ("low" | "high" | "any", docs/adr/0064) from the engine's own
// reading ("low" | "normal" | "high" | null, `AssetReading.impliedVolatility.label`): "normal" or
// no reading at all names no strong regime, the same thing "any" means to a recipe.
export function ivRegimeFromLabel(label: ImpliedVolatilityLabel | null): IvRegime {
  if (label === "low") return "low";
  if (label === "high") return "high";
  return "any";
}
