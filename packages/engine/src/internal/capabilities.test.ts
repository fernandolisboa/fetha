import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../api";
import { capabilities } from "./capabilities";

describe("capabilities", () => {
  it("reports every implemented indicator kind and timeframe", () => {
    const caps = capabilities();
    expect(caps.indicators).toEqual(["sma", "ema", "rsi", "atr", "iv_rank"]);
    expect(caps.timeframes).toEqual(["15m", "30m", "60m", "D1"]);
  });

  it("reports both sizing rules and every exit rule implemented for evaluateStrategy", () => {
    const caps = capabilities();
    expect(caps.sizingRules).toEqual(["fixed_fractional", "fixed_risk"]);
    expect(caps.exitRules).toEqual([
      "profit_target",
      "stop_loss",
      "condition",
      "days_before_expiry",
    ]);
  });

  it("reports the engine version", () => {
    expect(capabilities().engineVersion).toBe(ENGINE_VERSION);
  });

  it("reports priceOperation's implemented strike/expiry selections and pricing model", () => {
    const caps = capabilities();
    expect(caps.strikeSelections).toEqual(["delta", "moneyness", "nearest"]);
    expect(caps.expirySelections).toEqual(["business_days"]);
    expect(caps.pricingModels).toEqual(["bsm_continuous_yield"]);
  });

  it("reports the not-yet-implemented adjustmentRules vocabulary as empty", () => {
    const caps = capabilities();
    expect(caps.adjustmentRules).toEqual([]);
  });

  it("reports every implemented thesis claim kind", () => {
    expect(capabilities().thesisClaims).toEqual([
      "close_above",
      "close_below",
      "operation_pnl_positive",
    ]);
  });
});
