import { describe, expect, it } from "vitest";
import { structureSchema, tickerSchema, type Structure } from "@fetha/contracts";

import type { PlanChainEntry } from "./chain-view";
import { MAX_LOTS_SEARCHED } from "./sizing";
import { validateStructuralAdjustment } from "./validate-adjustment";

const CALL_BUTTERFLY: Structure = structureSchema.parse({
  id: "call-butterfly",
  name: "Borboleta com calls",
  expiry: "shared",
  legs: [
    { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "call", side: "sell", ratio: 2, strikeRank: 2 },
    { role: "call", side: "buy", ratio: 1, strikeRank: 3 },
  ],
});

const BULL_CALL_SPREAD: Structure = structureSchema.parse({
  id: "bull-call-spread",
  name: "Trava de alta com calls",
  expiry: "shared",
  legs: [
    { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
  ],
});

const EXPIRY = "2027-01-15" as PlanChainEntry["expiry"];
const OTHER_EXPIRY = "2027-02-19" as PlanChainEntry["expiry"];

function entry(ticker: string, strike: string, right: "call" | "put" = "call", expiry = EXPIRY): PlanChainEntry {
  return {
    ticker: tickerSchema.parse(ticker),
    right,
    strike: strike as PlanChainEntry["strike"],
    expiry,
    traded: true,
  };
}

const CHAIN: PlanChainEntry[] = [
  entry("PETRC034", "34.000000"),
  entry("PETRC036", "36.000000"),
  entry("PETRC038", "38.000000"),
  entry("PETRP036", "36.000000", "put"),
  entry("PETRC037", "37.000000", "call", OTHER_EXPIRY),
];

describe("validateStructuralAdjustment", () => {
  it("accepts a conforming butterfly with strictly increasing strikes", () => {
    const ok = validateStructuralAdjustment(
      CALL_BUTTERFLY,
      CHAIN,
      [tickerSchema.parse("PETRC034"), tickerSchema.parse("PETRC036"), tickerSchema.parse("PETRC038")],
      2,
    );
    expect(ok).toBe(true);
  });

  it("refuses equal strikes across adjacent ranks", () => {
    const ok = validateStructuralAdjustment(
      BULL_CALL_SPREAD,
      CHAIN,
      [tickerSchema.parse("PETRC036"), tickerSchema.parse("PETRC036")],
      1,
    );
    expect(ok).toBe(false);
  });

  it("refuses inverted strikes (the higher rank below the lower rank's strike)", () => {
    const ok = validateStructuralAdjustment(
      BULL_CALL_SPREAD,
      CHAIN,
      [tickerSchema.parse("PETRC038"), tickerSchema.parse("PETRC034")],
      1,
    );
    expect(ok).toBe(false);
  });

  it("refuses a mixed-expiry edit", () => {
    const ok = validateStructuralAdjustment(
      BULL_CALL_SPREAD,
      CHAIN,
      [tickerSchema.parse("PETRC034"), tickerSchema.parse("PETRC037")],
      1,
    );
    expect(ok).toBe(false);
  });

  it("refuses the wrong leg count", () => {
    const ok = validateStructuralAdjustment(
      BULL_CALL_SPREAD,
      CHAIN,
      [tickerSchema.parse("PETRC034")],
      1,
    );
    expect(ok).toBe(false);
  });

  it("refuses a leg whose listed right does not match the template's role", () => {
    const ok = validateStructuralAdjustment(
      BULL_CALL_SPREAD,
      CHAIN,
      [tickerSchema.parse("PETRC034"), tickerSchema.parse("PETRP036")],
      1,
    );
    expect(ok).toBe(false);
  });

  it("refuses lots above the cap", () => {
    const ok = validateStructuralAdjustment(
      BULL_CALL_SPREAD,
      CHAIN,
      [tickerSchema.parse("PETRC034"), tickerSchema.parse("PETRC036")],
      MAX_LOTS_SEARCHED + 1,
    );
    expect(ok).toBe(false);
  });
});
