import { describe, expect, it } from "vitest";
import { expectedMoves } from "@fetha/contracts";

import { radarStrings } from "./strings";

describe("radar strings", () => {
  it("names the structure and the ticker in both locales", () => {
    for (const locale of [radarStrings.en, radarStrings.ptBR]) {
      expect(locale.suggestions.cardTitle("Borboleta com calls", "PETR4")).toContain("PETR4");
    }
    expect(radarStrings.ptBR.suggestions.cardTitle("Borboleta com calls", "PETR4")).toBe(
      "Borboleta com calls em PETR4",
    );
  });

  it("has a scenario label for every expected move in both locales", () => {
    for (const locale of [radarStrings.en, radarStrings.ptBR]) {
      for (const move of expectedMoves) {
        expect(locale.suggestions.scenario[move]).toBeTruthy();
      }
    }
  });

  it("keeps the verb in the English debit loss clause (review round 2, finding #4)", () => {
    const { sentence } = radarStrings.en.suggestions;
    expect(
      sentence.between("R$1", "up to R$2", "X", "A", "B", "D", sentence.lossUpTo("R$3")),
    ).toContain("you lose up to R$3");
    expect(sentence.outside("R$1", "X", "A", "B", "D", sentence.unboundedLoss)).toContain(
      "you lose with no limit",
    );
    expect(
      sentence.above("R$1", "X", "A", "D", "up to R$2", sentence.lossClauseEqual("R$1")),
    ).toContain("you lose up to the R$1 you paid");
  });
});
