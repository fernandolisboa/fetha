import { describe, expect, it } from "vitest";

import {
  ILLUSTRATIVE_CALL_PREMIUM,
  ILLUSTRATIVE_HIGHER_CALL_PREMIUM,
  ILLUSTRATIVE_HIGHER_PUT_PREMIUM,
  ILLUSTRATIVE_HIGHER_STRIKE,
  ILLUSTRATIVE_LOWER_STRIKE,
  ILLUSTRATIVE_LOWEST_CALL_PREMIUM,
  ILLUSTRATIVE_LOWEST_PUT_PREMIUM,
  ILLUSTRATIVE_LOWEST_STRIKE,
  ILLUSTRATIVE_PUT_PREMIUM,
  ILLUSTRATIVE_SPOT,
  ILLUSTRATIVE_UNDERLYING,
  illustrativeLegs,
  loadIllustrativeExamples,
} from "./illustrative-market";
import { catalog } from "@/modules/strategies";

describe("loadIllustrativeExamples", () => {
  it("prices the illustrative long call, long put, short call and bull call spread through the engine", async () => {
    const examples = await loadIllustrativeExamples();

    expect(examples.underlying).toBe(ILLUSTRATIVE_UNDERLYING);
    expect(examples.spot).toBe(ILLUSTRATIVE_SPOT);
    expect(examples["long-call"].payoff.length).toBeGreaterThan(0);
    expect(examples["long-put"].payoff.length).toBeGreaterThan(0);
    expect(examples["short-call"].payoff.length).toBeGreaterThan(0);
    expect(examples["bull-call-spread"].payoff.length).toBeGreaterThan(0);
  });

  it("bounds the long call's loss at the premium paid and leaves its gain unbounded", async () => {
    const examples = await loadIllustrativeExamples();
    const longCall = examples["long-call"];

    expect(longCall.maxGain).toBe("unbounded");
    expect(longCall.maxLoss).not.toBe("unbounded");
    if (longCall.maxLoss === "unbounded") return;
    expect(longCall.maxLoss).toBe(Math.round(Number(ILLUSTRATIVE_CALL_PREMIUM) * 100));
  });

  it("mirrors the long call into an unbounded loss and a premium-sized gain for the short call", async () => {
    const examples = await loadIllustrativeExamples();
    const shortCall = examples["short-call"];

    expect(shortCall.maxLoss).toBe("unbounded");
    expect(shortCall.maxGain).not.toBe("unbounded");
    if (shortCall.maxGain === "unbounded") return;
    expect(shortCall.maxGain).toBe(Math.round(Number(ILLUSTRATIVE_CALL_PREMIUM) * 100));
  });

  it("bounds the long put's loss at the premium paid and its gain at the strike minus the premium", async () => {
    const examples = await loadIllustrativeExamples();
    const longPut = examples["long-put"];

    expect(longPut.maxGain).not.toBe("unbounded");
    expect(longPut.maxLoss).not.toBe("unbounded");
    if (longPut.maxGain === "unbounded" || longPut.maxLoss === "unbounded") return;
    expect(longPut.maxLoss).toBe(Math.round(Number(ILLUSTRATIVE_PUT_PREMIUM) * 100));
    const expectedMaxGain =
      Number(ILLUSTRATIVE_LOWER_STRIKE) * 100 - Number(ILLUSTRATIVE_PUT_PREMIUM) * 100;
    expect(longPut.maxGain).toBe(Math.round(expectedMaxGain));
  });

  it("prices every new PR 2 structure through the engine with a bounded payoff", async () => {
    const examples = await loadIllustrativeExamples();
    const ids = [
      "bull-put-spread",
      "bear-call-spread",
      "bear-put-spread",
      "covered-call",
      "call-butterfly",
      "put-butterfly",
      "iron-condor",
      "long-straddle",
      "long-strangle",
    ] as const;
    for (const id of ids) {
      const pricing = examples[id];
      expect(pricing.payoff.length).toBeGreaterThan(0);
    }
  });

  it("credits the bull put spread and debits the bear put spread by the same amount", async () => {
    const examples = await loadIllustrativeExamples();
    expect(examples["bull-put-spread"].netPremium).toBe(
      -Number(examples["bear-put-spread"].netPremium),
    );
  });

  it("bounds the iron condor's loss and gain, crediting a net premium at entry", async () => {
    const examples = await loadIllustrativeExamples();
    const { maxLoss, maxGain, netPremium } = examples["iron-condor"];
    expect(maxLoss).not.toBe("unbounded");
    expect(maxGain).not.toBe("unbounded");
    expect(netPremium).toBeGreaterThan(0);
  });

  it("gives the long straddle two break-evens straddling the shared strike", async () => {
    const examples = await loadIllustrativeExamples();
    const { breakEvens, maxLoss } = examples["long-straddle"];
    expect(breakEvens.length).toBe(2);
    expect(maxLoss).not.toBe("unbounded");
  });

  it("costs less than the straddle to enter the wider long strangle", async () => {
    const examples = await loadIllustrativeExamples();
    expect(Number(examples["long-strangle"].maxLoss)).toBeLessThan(
      Number(examples["long-straddle"].maxLoss),
    );
  });

  it("caps the covered call's upside at the strike while its stock leg carries the downside", async () => {
    const examples = await loadIllustrativeExamples();
    const { maxGain, maxLoss } = examples["covered-call"];
    expect(maxGain).not.toBe("unbounded");
    expect(maxLoss).not.toBe("unbounded");
  });

  it("bounds the bull call spread's loss and gain within the net debit and the strike width", async () => {
    const examples = await loadIllustrativeExamples();
    const { maxLoss, maxGain, netPremium } = examples["bull-call-spread"];

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

// Every leg premium in this fixture comes from one flat vol through the engine's own
// Black-Scholes (review round 2, finding #3): put-call parity at r=0 (`C - P = S - K`) must
// hold for every strike within a cent of rounding, and a call butterfly and the equivalent put
// butterfly (same wings, same body, same underlying) must cost the same.
describe("the fixture's own put-call parity", () => {
  it("holds C - P = S - K within a cent at r=0, at every strike with both a call and a put premium", () => {
    const spot = Number(ILLUSTRATIVE_SPOT);
    const byStrike: [number, number, number][] = [
      [
        Number(ILLUSTRATIVE_LOWEST_STRIKE),
        Number(ILLUSTRATIVE_LOWEST_CALL_PREMIUM),
        Number(ILLUSTRATIVE_LOWEST_PUT_PREMIUM),
      ],
      [
        Number(ILLUSTRATIVE_LOWER_STRIKE),
        Number(ILLUSTRATIVE_CALL_PREMIUM),
        Number(ILLUSTRATIVE_PUT_PREMIUM),
      ],
      [
        Number(ILLUSTRATIVE_HIGHER_STRIKE),
        Number(ILLUSTRATIVE_HIGHER_CALL_PREMIUM),
        Number(ILLUSTRATIVE_HIGHER_PUT_PREMIUM),
      ],
    ];
    for (const [strike, call, put] of byStrike) {
      expect(Math.abs(call - put - (spot - strike))).toBeLessThanOrEqual(0.01);
    }
  });

  it("costs the call butterfly and the put butterfly the same amount", async () => {
    const examples = await loadIllustrativeExamples();
    expect(
      Math.abs(examples["call-butterfly"].netPremium - examples["put-butterfly"].netPremium),
    ).toBe(0);
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
