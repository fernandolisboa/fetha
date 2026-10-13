import { describe, expect, it } from "vitest";

import {
  ILLUSTRATIVE_CALL_PREMIUM,
  ILLUSTRATIVE_HIGHER_CALL_PREMIUM,
  ILLUSTRATIVE_HIGHER_STRIKE,
  ILLUSTRATIVE_LOWER_STRIKE,
  ILLUSTRATIVE_PUT_PREMIUM,
  ILLUSTRATIVE_SPOT,
  ILLUSTRATIVE_UNDERLYING,
  illustrativeLegs,
  loadOptions101Examples,
} from "./options-101";
import { catalog } from "@/modules/strategies";

describe("loadOptions101Examples", () => {
  it("prices the illustrative long call, long put and bull call spread through the engine", async () => {
    const examples = await loadOptions101Examples();

    expect(examples.underlying).toBe(ILLUSTRATIVE_UNDERLYING);
    expect(examples.spot).toBe(ILLUSTRATIVE_SPOT);
    expect(examples.longCall.payoff.length).toBeGreaterThan(0);
    expect(examples.longPut.payoff.length).toBeGreaterThan(0);
    expect(examples.bullCallSpread.payoff.length).toBeGreaterThan(0);
  });

  it("bounds the long call's loss at the premium paid and leaves its gain unbounded", async () => {
    const { longCall } = await loadOptions101Examples();

    expect(longCall.maxGain).toBe("unbounded");
    expect(longCall.maxLoss).not.toBe("unbounded");
    if (longCall.maxLoss === "unbounded") return;
    expect(longCall.maxLoss).toBe(Math.round(Number(ILLUSTRATIVE_CALL_PREMIUM) * 100));
  });

  it("bounds the long put's loss at the premium paid and its gain at the strike minus the premium", async () => {
    const { longPut } = await loadOptions101Examples();

    expect(longPut.maxGain).not.toBe("unbounded");
    expect(longPut.maxLoss).not.toBe("unbounded");
    if (longPut.maxGain === "unbounded" || longPut.maxLoss === "unbounded") return;
    expect(longPut.maxLoss).toBe(Math.round(Number(ILLUSTRATIVE_PUT_PREMIUM) * 100));
    const expectedMaxGain =
      Number(ILLUSTRATIVE_LOWER_STRIKE) * 100 - Number(ILLUSTRATIVE_PUT_PREMIUM) * 100;
    expect(longPut.maxGain).toBe(Math.round(expectedMaxGain));
  });

  it("bounds the bull call spread's loss and gain within the net debit and the strike width", async () => {
    const { bullCallSpread } = await loadOptions101Examples();
    const { maxLoss, maxGain, netPremium } = bullCallSpread;

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

describe("illustrativeLegs", () => {
  it.each(Object.entries(illustrativeLegs))(
    "builds %s with the catalog structure's own legs",
    (structureId, legs) => {
      const entry = catalog.find((candidate) => candidate.structure.id === structureId);
      expect(entry).toBeDefined();
      expect(legs.map(({ role, side, quantity }) => ({ role, side, ratio: quantity }))).toEqual(
        entry?.structure.legs.map(({ role, side, ratio }) => ({ role, side, ratio })),
      );
    },
  );
});
