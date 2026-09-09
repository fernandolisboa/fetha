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

// The engine cannot import contracts vocabularies as runtime values (ADR-0013), so
// conformance is checked at the type level: every kind capabilities() can report is
// structurally a member of the matching contracts union, in both directions, which is
// a stronger guarantee than a runtime subset check and cannot silently drift.
describe("capabilities() conformance with the contracts vocabularies", () => {
  it("indicators is implemented in full and matches the contracts IndicatorSpec kinds exactly", () => {
    expectTypeOf<ReturnType<typeof capabilities>["indicators"][number]>().toEqualTypeOf<
      IndicatorSpec["kind"]
    >();
    expect(capabilities().indicators).toEqual([
      "sma",
      "ema",
      "rsi",
      "atr",
      "iv_rank",
    ] satisfies IndicatorSpec["kind"][]);
  });

  it("timeframes is implemented in full and matches the contracts Timeframe kinds exactly", () => {
    expectTypeOf<
      ReturnType<typeof capabilities>["timeframes"][number]
    >().toEqualTypeOf<Timeframe>();
    expect(capabilities().timeframes).toEqual(["15m", "30m", "60m", "D1"] satisfies Timeframe[]);
  });

  it("leaves every vocabulary whose methods are not implemented yet (issue #14) empty", () => {
    const caps = capabilities();
    expectTypeOf<(typeof caps)["strikeSelections"][number]>().toEqualTypeOf<
      StrikeSelection["kind"]
    >();
    expectTypeOf<(typeof caps)["expirySelections"][number]>().toEqualTypeOf<
      ExpirySelection["kind"]
    >();
    expectTypeOf<(typeof caps)["sizingRules"][number]>().toEqualTypeOf<SizingRule["kind"]>();
    expectTypeOf<(typeof caps)["exitRules"][number]>().toEqualTypeOf<ExitRule["kind"]>();
    expectTypeOf<(typeof caps)["adjustmentRules"][number]>().toEqualTypeOf<
      AdjustmentRule["kind"]
    >();
    expectTypeOf<(typeof caps)["thesisClaims"][number]>().toEqualTypeOf<ThesisClaim["kind"]>();
    expect(caps.strikeSelections).toEqual([]);
    expect(caps.expirySelections).toEqual([]);
    expect(caps.sizingRules).toEqual([]);
    expect(caps.exitRules).toEqual([]);
    expect(caps.adjustmentRules).toEqual([]);
    expect(caps.thesisClaims).toEqual([]);
    expect(caps.pricingModels).toEqual([]);
  });
});
