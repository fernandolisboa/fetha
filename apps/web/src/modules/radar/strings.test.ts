import { describe, expect, it } from "vitest";

import { recipes } from "@/modules/strategies";

import { radarStrings } from "./strings";

describe("radar strings", () => {
  it("has a direct-voice headline for every recipe in both locales", () => {
    for (const locale of [radarStrings.en, radarStrings.ptBR]) {
      const headlines: Partial<Record<string, (ticker: string) => string>> =
        locale.suggestions.headline;
      for (const recipe of recipes) {
        expect(headlines[recipe.id]?.("PETR4")).toContain("PETR4");
      }
    }
    expect(radarStrings.ptBR.suggestions.headline["bull-call-spread-low-iv"]("PETR4")).toBe(
      "Uma trava de alta com calls em PETR4 cabe agora.",
    );
  });
});
