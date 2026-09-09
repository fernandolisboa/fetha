import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AdjustmentRule,
  ExitRule,
  ExpirySelection,
  IndicatorSpec,
  SizingRule,
  StrikeSelection,
  ThesisClaim,
  Timeframe,
} from "@fetha/contracts";
import { pricingModels } from "../api";
import { capabilities } from "../internal/capabilities";
import {
  implementedExitRuleKinds,
  implementedExpirySelectionKinds,
  implementedIndicatorKinds,
  implementedSizingRuleKinds,
  implementedStrikeSelectionKinds,
  implementedTimeframes,
  unsupportedAdjustmentRuleKinds,
  unsupportedExitRuleKinds,
  unsupportedExpirySelectionKinds,
  unsupportedSizingRuleKinds,
  unsupportedStrikeSelectionKinds,
  unsupportedThesisClaimKinds,
} from "../internal/vocabularies";

// The engine cannot import contracts vocabularies as runtime values (ADR-0013), so
// conformance is checked at the type level against the engine's own implemented*/
// unsupported* arrays (declared in internal/vocabularies.ts and satisfies-checked
// against the contracts type at their declaration site): every kind capabilities()
// can report, plus every kind explicitly marked unsupported, together enumerate the
// matching contracts union exactly. A kind that is neither implemented nor listed as
// unsupported fails to type-check here, so drift cannot land silently.
describe("capabilities() conformance with the contracts vocabularies", () => {
  it("indicators is implemented in full and matches the contracts IndicatorSpec kinds exactly", () => {
    expectTypeOf<(typeof implementedIndicatorKinds)[number]>().toEqualTypeOf<
      IndicatorSpec["kind"]
    >();
    expect(capabilities().indicators).toEqual([...implementedIndicatorKinds]);
  });

  it("timeframes is implemented in full and matches the contracts Timeframe kinds exactly", () => {
    expectTypeOf<(typeof implementedTimeframes)[number]>().toEqualTypeOf<Timeframe>();
    expect(capabilities().timeframes).toEqual([...implementedTimeframes]);
  });

  it("strikeSelections is implemented in full and matches the contracts StrikeSelection kinds exactly", () => {
    expect(unsupportedStrikeSelectionKinds).toEqual([]);
    expectTypeOf<(typeof implementedStrikeSelectionKinds)[number]>().toEqualTypeOf<
      StrikeSelection["kind"]
    >();
    expect(capabilities().strikeSelections).toEqual([...implementedStrikeSelectionKinds]);
  });

  it("expirySelections is implemented in full and matches the contracts ExpirySelection kinds exactly", () => {
    expect(unsupportedExpirySelectionKinds).toEqual([]);
    expectTypeOf<(typeof implementedExpirySelectionKinds)[number]>().toEqualTypeOf<
      ExpirySelection["kind"]
    >();
    expect(capabilities().expirySelections).toEqual([...implementedExpirySelectionKinds]);
  });

  it("sizingRules is implemented in full for stock-only strategies and matches the contracts kinds exactly", () => {
    expect(unsupportedSizingRuleKinds).toEqual([]);
    expectTypeOf<(typeof implementedSizingRuleKinds)[number]>().toEqualTypeOf<SizingRule["kind"]>();
    expect(capabilities().sizingRules).toEqual([...implementedSizingRuleKinds]);
  });

  it("exitRules is implemented for the stock-only subset and the rest is unsupported", () => {
    expectTypeOf<
      (typeof implementedExitRuleKinds)[number] | (typeof unsupportedExitRuleKinds)[number]
    >().toEqualTypeOf<ExitRule["kind"]>();
    expect(capabilities().exitRules).toEqual([...implementedExitRuleKinds]);
  });

  it("every adjustmentRules kind is unsupported (no adjustment-rule method is implemented yet)", () => {
    expectTypeOf<(typeof unsupportedAdjustmentRuleKinds)[number]>().toEqualTypeOf<
      AdjustmentRule["kind"]
    >();
    expect(capabilities().adjustmentRules).toEqual([]);
  });

  it("every thesisClaims kind is unsupported (no scoring method is implemented yet)", () => {
    expectTypeOf<(typeof unsupportedThesisClaimKinds)[number]>().toEqualTypeOf<
      ThesisClaim["kind"]
    >();
    expect(capabilities().thesisClaims).toEqual([]);
  });

  it("pricingModels is implemented in full (bsm_continuous_yield, ADR-0002)", () => {
    expect(capabilities().pricingModels).toEqual([...pricingModels]);
  });
});
