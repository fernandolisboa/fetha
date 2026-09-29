import { describe, expect, it } from "vitest";
import { decimalStringSchema, structureSchema, type StrikeSelection } from "@fetha/contracts";

import { strikesFittedTo } from "./fit-strikes";

const straddle = structureSchema.parse({
  id: "left-behind",
  name: "Fora do catálogo",
  expiry: "shared",
  legs: [
    { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
  ],
});

function moneyness(percent: string): StrikeSelection {
  return { kind: "moneyness", percent: decimalStringSchema.parse(percent) };
}

describe("strikesFittedTo", () => {
  it("keeps one strike per distinct rank of a structure outside the catalog", () => {
    expect(
      strikesFittedTo(straddle, [moneyness("-0.05"), moneyness("0"), moneyness("0.05")]),
    ).toEqual([moneyness("-0.05")]);
  });

  it("pads a short strike list at the money", () => {
    expect(
      strikesFittedTo(
        {
          ...straddle,
          legs: [...straddle.legs, { role: "call", side: "sell", ratio: 1, strikeRank: 2 }],
        },
        [],
      ),
    ).toEqual([moneyness("0"), moneyness("0")]);
  });

  it("asks no strike of a stock-only structure", () => {
    expect(
      strikesFittedTo({ ...straddle, legs: [{ role: "stock", side: "buy", ratio: 1 }] }, [
        moneyness("0"),
      ]),
    ).toEqual([]);
  });
});
