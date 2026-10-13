import { describe, expect, it } from "vitest";

import {
  ILLUSTRATIVE_CALL_PREMIUM,
  ILLUSTRATIVE_HIGHER_CALL_PREMIUM,
  ILLUSTRATIVE_HIGHER_STRIKE,
  ILLUSTRATIVE_LOWER_STRIKE,
  ILLUSTRATIVE_PUT_PREMIUM,
  ILLUSTRATIVE_SPOT,
  ILLUSTRATIVE_UNDERLYING,
  loadOptions101Examples,
} from "./options-101";

describe("loadOptions101Examples", () => {
  it("prices the illustrative long call, long put and bull call spread through the engine", async () => {
    const examples = await loadOptions101Examples();

    expect(examples.underlying).toBe(ILLUSTRATIVE_UNDERLYING);
    expect(examples.spot).toBe(ILLUSTRATIVE_SPOT);
    expect(examples.longCall.pricing.payoff.length).toBeGreaterThan(0);
    expect(examples.longPut.pricing.payoff.length).toBeGreaterThan(0);
    expect(examples.bullCallSpread.pricing.payoff.length).toBeGreaterThan(0);
  });

  it("bounds the long call's loss at the premium paid and leaves its gain unbounded", async () => {
    const { longCall } = await loadOptions101Examples();

    expect(longCall.pricing.maxGain).toBe("unbounded");
    expect(longCall.pricing.maxLoss).not.toBe("unbounded");
    if (longCall.pricing.maxLoss === "unbounded") return;
    expect(longCall.pricing.maxLoss).toBe(Math.round(Number(ILLUSTRATIVE_CALL_PREMIUM) * 100));
  });

  it("bounds the long put's loss at the premium paid and its gain at the strike minus the premium", async () => {
    const { longPut } = await loadOptions101Examples();

    expect(longPut.pricing.maxGain).not.toBe("unbounded");
    expect(longPut.pricing.maxLoss).not.toBe("unbounded");
    if (longPut.pricing.maxGain === "unbounded" || longPut.pricing.maxLoss === "unbounded") return;
    expect(longPut.pricing.maxLoss).toBe(Math.round(Number(ILLUSTRATIVE_PUT_PREMIUM) * 100));
    const expectedMaxGain =
      Number(ILLUSTRATIVE_LOWER_STRIKE) * 100 - Number(ILLUSTRATIVE_PUT_PREMIUM) * 100;
    expect(longPut.pricing.maxGain).toBe(Math.round(expectedMaxGain));
  });

  it("bounds the bull call spread's loss and gain within the net debit and the strike width", async () => {
    const { bullCallSpread } = await loadOptions101Examples();
    const { maxLoss, maxGain, netPremium } = bullCallSpread.pricing;

    expect(maxLoss).not.toBe("unbounded");
    expect(maxGain).not.toBe("unbounded");
    if (maxLoss === "unbounded" || maxGain === "unbounded") return;

    const netDebit = Math.round(
      (Number(ILLUSTRATIVE_CALL_PREMIUM) - Number(ILLUSTRATIVE_HIGHER_CALL_PREMIUM)) * 100,
    );
    const strikeWidth = Math.round(
      (Number(ILLUSTRATIVE_HIGHER_STRIKE) - Number(ILLUSTRATIVE_LOWER_STRIKE)) * 100,
    );
    expect(netPremium).toBe(-netDebit);
    expect(maxLoss).toBe(netDebit);
    expect(maxGain).toBe(strikeWidth - netDebit);
  });
});
