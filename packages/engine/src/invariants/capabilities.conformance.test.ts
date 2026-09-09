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
import { capabilities } from "../internal/capabilities";
import {
  implementedIndicatorKinds,
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

  it("every strikeSelections kind is unsupported (no strike-selection method is implemented yet)", () => {
    expectTypeOf<(typeof unsupportedStrikeSelectionKinds)[number]>().toEqualTypeOf<
      StrikeSelection["kind"]
    >();
    expect(capabilities().strikeSelections).toEqual([]);
  });

  it("every expirySelections kind is unsupported (no expiry-selection method is implemented yet)", () => {
    expectTypeOf<(typeof unsupportedExpirySelectionKinds)[number]>().toEqualTypeOf<
      ExpirySelection["kind"]
    >();
    expect(capabilities().expirySelections).toEqual([]);
  });

  it("every sizingRules kind is unsupported (no sizing method is implemented yet)", () => {
    expectTypeOf<(typeof unsupportedSizingRuleKinds)[number]>().toEqualTypeOf<SizingRule["kind"]>();
    expect(capabilities().sizingRules).toEqual([]);
  });

  it("every exitRules kind is unsupported (no exit-rule method is implemented yet)", () => {
    expectTypeOf<(typeof unsupportedExitRuleKinds)[number]>().toEqualTypeOf<ExitRule["kind"]>();
    expect(capabilities().exitRules).toEqual([]);
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

  it("pricingModels is left empty until a pricing method is implemented", () => {
    expect(capabilities().pricingModels).toEqual([]);
  });
});
