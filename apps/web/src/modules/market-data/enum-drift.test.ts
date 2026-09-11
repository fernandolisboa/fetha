import { describe, expect, it } from "vitest";
import { exerciseStyleSchema, macroSeriesKindSchema, optionRightSchema } from "@fetha/contracts";
import { exerciseStyles, macroSeriesKinds, optionRights } from "@fetha/engine";

// `packages/contracts` cannot import from `packages/engine` (the engine
// depends on contracts, never the other way, scalars.ts's own comment),
// so its option/exerciseStyle/macroSeriesKind schemas mirror the engine's
// own `optionRights`/`exerciseStyles`/`macroSeriesKinds` arrays by value.
// `apps/web` is the one place that already depends on both, so this is
// where a future engine change that adds, removes or renames a member
// without updating the mirrored schema fails loudly instead of parsing
// silently wrong at the market-data edge (round 3 item 10).
describe("contracts enum schemas mirror the engine's own vocabularies", () => {
  it("optionRightSchema matches engine.optionRights", () => {
    expect([...optionRightSchema.options].sort()).toEqual([...optionRights].sort());
  });

  it("exerciseStyleSchema matches engine.exerciseStyles", () => {
    expect([...exerciseStyleSchema.options].sort()).toEqual([...exerciseStyles].sort());
  });

  it("macroSeriesKindSchema matches engine.macroSeriesKinds", () => {
    expect([...macroSeriesKindSchema.options].sort()).toEqual([...macroSeriesKinds].sort());
  });
});
