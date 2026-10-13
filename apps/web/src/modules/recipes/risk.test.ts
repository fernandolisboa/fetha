import { describe, expect, it } from "vitest";
import { centavosSchema } from "@fetha/contracts";

import { recipeRiskFractions, riskBudget } from "./risk";

describe("riskBudget", () => {
  it("is the declared capital times the fraction, in whole centavos", () => {
    const capital = centavosSchema.parse(1_000_000);

    expect(recipeRiskFractions.map((fraction) => riskBudget(capital, fraction))).toEqual([
      10_000, 20_000, 50_000,
    ]);
  });

  it("rounds a fractional centavo down, never up past what the user accepted", () => {
    expect(riskBudget(centavosSchema.parse(12_345), "0.01")).toBe(123);
  });
});
