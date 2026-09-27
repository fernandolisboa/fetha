import { describe, expect, it } from "vitest";
import {
  exerciseStyleSchema,
  macroSeriesKindSchema,
  marketViewCollectionSchema,
  noteCodeSchema,
  optionRightSchema,
  pricingModelSchema,
  truncationReasonSchema,
} from "@fetha/contracts";
import {
  exerciseStyles,
  macroSeriesKinds,
  marketViewCollections,
  noteCodes,
  optionRights,
  pricingModels,
  truncationReasons,
} from "@fetha/engine";

// `packages/contracts` cannot import from `packages/engine` (the engine
// depends on contracts, never the other way, scalars.ts's own comment),
// so its market-data and backtest-report vocabulary schemas mirror the
// engine's own `as const` arrays by value. `apps/web` is the one place that
// already depends on both, so this is where a future engine change that
// adds, removes or renames a member without updating the mirrored schema
// fails loudly instead of parsing silently wrong at the market-data edge or
// rejecting a stored backtest report.
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

  it("noteCodeSchema matches engine.noteCodes", () => {
    expect([...noteCodeSchema.options].sort()).toEqual([...noteCodes].sort());
  });

  it("pricingModelSchema matches engine.pricingModels", () => {
    expect([...pricingModelSchema.options].sort()).toEqual([...pricingModels].sort());
  });

  it("marketViewCollectionSchema matches engine.marketViewCollections", () => {
    expect([...marketViewCollectionSchema.options].sort()).toEqual(
      [...marketViewCollections].sort(),
    );
  });

  it("truncationReasonSchema matches engine.truncationReasons", () => {
    expect([...truncationReasonSchema.options].sort()).toEqual([...truncationReasons].sort());
  });
});
