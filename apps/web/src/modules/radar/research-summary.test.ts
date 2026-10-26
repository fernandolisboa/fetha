import { describe, expect, it } from "vitest";

import { researchSummary } from "./research-summary";

describe("researchSummary", () => {
  it("counts the ideas looked at and each drop reason, in the owner's words", () => {
    expect(
      researchSummary({
        candidates: 16,
        sessionsLooked: 3,
        dropped: { unpriced: 2, expires_too_soon: 1, exceeds_capital: 1, not_evaluable: 0 },
      }),
    ).toBe(
      "Olhei 16 ideias de 3 pregões; 4 descartadas: 2 sem preço hoje, 1 vence em menos de 5 pregões, 1 perda maior que o seu capital.",
    );
  });

  it("leaves out the drops when nothing was dropped and agrees in number", () => {
    expect(
      researchSummary({
        candidates: 1,
        sessionsLooked: 1,
        dropped: { unpriced: 0, expires_too_soon: 0, exceeds_capital: 0, not_evaluable: 0 },
      }),
    ).toBe("Olhei 1 ideia de 1 pregão.");
    expect(
      researchSummary({
        candidates: 5,
        sessionsLooked: 2,
        dropped: { unpriced: 0, expires_too_soon: 3, exceeds_capital: 2, not_evaluable: 0 },
      }),
    ).toBe(
      "Olhei 5 ideias de 2 pregões; 5 descartadas: 3 vencem em menos de 5 pregões, 2 perdas maiores que o seu capital.",
    );
  });

  it("says when the rule could not be checked for lack of data", () => {
    expect(
      researchSummary({
        candidates: 3,
        sessionsLooked: 1,
        dropped: { unpriced: 0, expires_too_soon: 0, exceeds_capital: 0, not_evaluable: 1 },
      }),
    ).toBe("Olhei 3 ideias de 1 pregão; 1 descartada: 1 sem dados para avaliar a regra hoje.");
  });
});
