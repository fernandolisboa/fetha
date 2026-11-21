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
});
