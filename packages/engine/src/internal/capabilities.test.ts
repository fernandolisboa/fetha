import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../api";
import { capabilities } from "./capabilities";

describe("capabilities", () => {
  it("reports every implemented indicator kind and timeframe", () => {
    const caps = capabilities();
    expect(caps.indicators).toEqual(["sma", "ema", "rsi", "atr", "iv_rank"]);
    expect(caps.timeframes).toEqual(["15m", "30m", "60m", "D1"]);
  });

  it("reports both sizing rules and the stock-only exit rules implemented for evaluateStrategy", () => {
    const caps = capabilities();
    expect(caps.sizingRules).toEqual(["fixed_fractional", "fixed_risk"]);
    expect(caps.exitRules).toEqual(["profit_target", "stop_loss", "condition"]);
  });

  it("reports the engine version", () => {
    expect(capabilities().engineVersion).toBe(ENGINE_VERSION);
  });

  it("reports the not-yet-implemented vocabularies as empty until their methods land", () => {
    const caps = capabilities();
    expect(caps.strikeSelections).toEqual([]);
    expect(caps.expirySelections).toEqual([]);
    expect(caps.adjustmentRules).toEqual([]);
    expect(caps.thesisClaims).toEqual([]);
    expect(caps.pricingModels).toEqual([]);
  });
});
