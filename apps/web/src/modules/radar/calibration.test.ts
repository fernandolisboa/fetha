import { describe, expect, it } from "vitest";

import { suggestionCalibration } from "./calibration";

describe("suggestionCalibration", () => {
  it("counts scored, judged and held suggestions and sums their P&L, per recipe and overall", () => {
    const calibration = suggestionCalibration([
      { recipeId: "long-call-low-iv", claimHeld: true, pnlCentavos: 12000, normalizedPnl: "1.2" },
      { recipeId: "long-call-low-iv", claimHeld: false, pnlCentavos: -10000, normalizedPnl: "-1" },
      { recipeId: "call-butterfly", claimHeld: null, pnlCentavos: -500, normalizedPnl: null },
    ]);

    expect(calibration.overall).toMatchObject({ scored: 3, claimed: 2, held: 1, pnl: 1500 });
    expect(calibration.byRecipe).toEqual([
      {
        recipeId: "long-call-low-iv",
        recipeName: "Compra de call",
        scored: 2,
        claimed: 2,
        held: 1,
        pnl: 2000,
      },
      {
        recipeId: "call-butterfly",
        recipeName: "Borboleta com calls",
        scored: 1,
        claimed: 0,
        held: 0,
        pnl: -500,
      },
    ]);
  });

  it("is empty with no scored suggestion", () => {
    expect(suggestionCalibration([])).toEqual({
      overall: { recipeId: null, recipeName: null, scored: 0, claimed: 0, held: 0, pnl: 0 },
      byRecipe: [],
    });
  });
});
