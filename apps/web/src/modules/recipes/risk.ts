import { Decimal } from "decimal.js";
import { centavosSchema, type Centavos } from "@fetha/contracts";

export const recipeRiskFractions = ["0.01", "0.02", "0.05"] as const;
export type RecipeRiskFraction = (typeof recipeRiskFractions)[number];
export const DEFAULT_RECIPE_RISK_FRACTION: RecipeRiskFraction = "0.02";

// The engine sizes fixed_risk as floor(capital × fraction / max loss per
// unit), so this budget is the structure's max loss on the declared capital.
// It is approximate, not a cap: costs come on top, and the backtest sizes on
// its current equity, so the budget drifts with the equity curve.
export function riskBudget(declaredCapital: Centavos, fraction: RecipeRiskFraction): Centavos {
  return centavosSchema.parse(
    new Decimal(declaredCapital).mul(fraction).toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber(),
  );
}
