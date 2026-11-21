import { describe, expect, it } from "vitest";
import { tickerSchema, type DecimalString, type SessionDate } from "@fetha/contracts";

import type { PlanChainEntry } from "./chain-view";
import {
  allStrikesFor,
  allStrikesForRank,
  boundedStrikes,
  commonSelectableStrikes,
  indexOfTicker,
  rankBoundsFor,
  ranksOf,
  remapToExpiry,
  selectableStrikes,
  stepStrike,
  stepStrikeValue,
  tickerAtStrike,
} from "./leg-strikes";
import type { OptionLegTemplate } from "./template-legs";

function entry(
  ticker: string,
  strike: string,
  expiry: SessionDate,
  right: "call" | "put" = "call",
  traded = true,
): PlanChainEntry {
  return {
    ticker: tickerSchema.parse(ticker),
    right,
    strike: strike as DecimalString,
    expiry,
    traded,
  };
}

const EXPIRY_A = "2027-01-15" as SessionDate;
const EXPIRY_B = "2027-02-19" as SessionDate;

const CHAIN: PlanChainEntry[] = [
  entry("PETRC034", "34.000000", EXPIRY_A),
  entry("PETRC036", "36.000000", EXPIRY_A),
  entry("PETRC038", "38.000000", EXPIRY_A, "call", false),
  entry("PETRC040", "40.000000", EXPIRY_A),
  entry("PETRP034", "34.000000", EXPIRY_A, "put"),
  entry("PETRP036", "36.000000", EXPIRY_A, "put"),
  entry("PETRC037", "37.000000", EXPIRY_B),
  entry("PETRC041", "41.000000", EXPIRY_B),
];

describe("selectableStrikes", () => {
  it("keeps only traded strikes of the right right and expiry, sorted ascending", () => {
    const strikes = selectableStrikes(CHAIN, "call", EXPIRY_A);
    expect(strikes.map((entry) => entry.ticker)).toEqual(["PETRC034", "PETRC036", "PETRC040"]);
  });

  it("excludes the other option right", () => {
    const strikes = selectableStrikes(CHAIN, "put", EXPIRY_A);
    expect(strikes.map((entry) => entry.ticker)).toEqual(["PETRP034", "PETRP036"]);
  });
});

describe("allStrikesFor", () => {
  it("keeps the untraded strikes too, sorted ascending", () => {
    const strikes = allStrikesFor(CHAIN, "call", EXPIRY_A);
    expect(strikes.map((entry) => entry.ticker)).toEqual([
      "PETRC034",
      "PETRC036",
      "PETRC038",
      "PETRC040",
    ]);
    expect(strikes.map((entry) => entry.traded)).toEqual([true, true, false, true]);
  });
});

describe("tickerAtStrike", () => {
  it("finds the listed ticker at a given numeric strike", () => {
    const strikes = allStrikesFor(CHAIN, "call", EXPIRY_A);
    expect(tickerAtStrike(strikes, 38)).toBe("PETRC038");
  });

  it("returns null for a price nothing is listed at", () => {
    const strikes = allStrikesFor(CHAIN, "call", EXPIRY_A);
    expect(tickerAtStrike(strikes, 39)).toBeNull();
  });
});

describe("indexOfTicker", () => {
  it("finds a listed ticker's position", () => {
    const strikes = selectableStrikes(CHAIN, "call", EXPIRY_A);
    expect(indexOfTicker(strikes, tickerSchema.parse("PETRC036"))).toBe(1);
  });

  it("returns -1 for a ticker not in the list", () => {
    const strikes = selectableStrikes(CHAIN, "call", EXPIRY_A);
    expect(indexOfTicker(strikes, tickerSchema.parse("PETRC999"))).toBe(-1);
  });
});

describe("stepStrike", () => {
  const strikes = selectableStrikes(CHAIN, "call", EXPIRY_A);

  it("moves to the next higher traded strike", () => {
    expect(stepStrike(strikes, tickerSchema.parse("PETRC034"), 1)).toBe("PETRC036");
  });

  it("moves to the next lower traded strike", () => {
    expect(stepStrike(strikes, tickerSchema.parse("PETRC040"), -1)).toBe("PETRC036");
  });

  it("clamps at the highest strike", () => {
    expect(stepStrike(strikes, tickerSchema.parse("PETRC040"), 1)).toBe("PETRC040");
  });

  it("clamps at the lowest strike", () => {
    expect(stepStrike(strikes, tickerSchema.parse("PETRC034"), -1)).toBe("PETRC034");
  });

  it("returns null when there is nothing selectable", () => {
    expect(stepStrike([], tickerSchema.parse("PETRC034"), 1)).toBeNull();
  });

  it("returns null for a ticker not in the list, rather than stepping from the first one", () => {
    expect(stepStrike(strikes, tickerSchema.parse("PETRC999"), 1)).toBeNull();
  });
});

describe("boundedStrikes", () => {
  const strikes = selectableStrikes(CHAIN, "call", EXPIRY_A);

  it("drops a strike at or below the lower bound", () => {
    const bounded = boundedStrikes(strikes, 34, null);
    expect(bounded.map((entry) => entry.ticker)).toEqual(["PETRC036", "PETRC040"]);
  });

  it("drops a strike at or above the upper bound", () => {
    const bounded = boundedStrikes(strikes, null, 40);
    expect(bounded.map((entry) => entry.ticker)).toEqual(["PETRC034", "PETRC036"]);
  });

  it("keeps everything when both bounds are absent", () => {
    expect(boundedStrikes(strikes, null, null)).toEqual(strikes);
  });
});

describe("rankBoundsFor", () => {
  const butterfly: OptionLegTemplate[] = [
    { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "call", side: "sell", ratio: 2, strikeRank: 2 },
    { role: "call", side: "buy", ratio: 1, strikeRank: 3 },
  ];
  const currentStrikes = [34, 36, 38];

  it("bounds the middle wing by its lower and upper neighbours' current strikes", () => {
    const bounds = rankBoundsFor(butterfly, (index) => currentStrikes[index] ?? null);
    expect(bounds[1]).toEqual({ lower: 34, upper: 38 });
  });

  it("leaves the lowest rank with no lower bound and the highest with no upper bound", () => {
    const bounds = rankBoundsFor(butterfly, (index) => currentStrikes[index] ?? null);
    expect(bounds[0]).toEqual({ lower: null, upper: 36 });
    expect(bounds[2]).toEqual({ lower: 36, upper: null });
  });

  it("never bounds a leg against another leg sharing the same rank", () => {
    const boxLikePair: OptionLegTemplate[] = [
      { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
      { role: "put", side: "buy", ratio: 1, strikeRank: 2 },
    ];
    const bounds = rankBoundsFor(boxLikePair, (index) => (index === 0 ? 38 : 38));
    expect(bounds).toEqual([
      { lower: null, upper: null },
      { lower: null, upper: null },
    ]);
  });
});

describe("stepStrikeValue", () => {
  const strikes = selectableStrikes(CHAIN, "call", EXPIRY_A);

  it("moves to the next higher traded strike value", () => {
    expect(stepStrikeValue(strikes, 34, 1)).toBe(36);
  });

  it("moves to the next lower traded strike value", () => {
    expect(stepStrikeValue(strikes, 40, -1)).toBe(36);
  });

  it("clamps at either end", () => {
    expect(stepStrikeValue(strikes, 40, 1)).toBe(40);
    expect(stepStrikeValue(strikes, 34, -1)).toBe(34);
  });

  it("returns null for a value not in the list", () => {
    expect(stepStrikeValue(strikes, 99, 1)).toBeNull();
  });
});

describe("ranksOf", () => {
  it("groups legs sharing a rank together, ascending by rank", () => {
    const straddle: OptionLegTemplate[] = [
      { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
      { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
    ];
    expect(ranksOf(straddle)).toEqual([{ strikeRank: 1, legIndices: [0, 1] }]);
  });

  it("keeps a butterfly's three ranks apart, one leg each", () => {
    const butterfly: OptionLegTemplate[] = [
      { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
      { role: "call", side: "sell", ratio: 2, strikeRank: 2 },
      { role: "call", side: "buy", ratio: 1, strikeRank: 3 },
    ];
    expect(ranksOf(butterfly)).toEqual([
      { strikeRank: 1, legIndices: [0] },
      { strikeRank: 2, legIndices: [1] },
      { strikeRank: 3, legIndices: [2] },
    ]);
  });
});

describe("commonSelectableStrikes", () => {
  it("keeps only strikes traded for every right given", () => {
    const strikes = commonSelectableStrikes(CHAIN, ["call", "put"], EXPIRY_A);
    expect(strikes.map((entry) => entry.ticker)).toEqual(["PETRC034", "PETRC036"]);
  });

  it("drops a strike traded for only one of the rights (a straddle's own call without a put, or vice versa)", () => {
    const strikes = commonSelectableStrikes(CHAIN, ["call", "put"], EXPIRY_A);
    expect(strikes.some((entry) => entry.ticker === "PETRC040")).toBe(false);
  });

  it("reduces to selectableStrikes for a single right", () => {
    expect(commonSelectableStrikes(CHAIN, ["call"], EXPIRY_A)).toEqual(
      selectableStrikes(CHAIN, "call", EXPIRY_A),
    );
  });
});

describe("allStrikesForRank", () => {
  it("unions both rights' own strikes, traded or not", () => {
    const values = allStrikesForRank(CHAIN, ["call", "put"], EXPIRY_A);
    expect(values).toEqual([34, 36, 38, 40]);
  });
});

describe("remapToExpiry", () => {
  it("snaps to the nearest traded strike of the new expiry", () => {
    const next = remapToExpiry(CHAIN, "call", "36.000000" as DecimalString, EXPIRY_B);
    expect(next).toBe("PETRC037");
  });

  it("returns null when the new expiry has nothing traded for that right", () => {
    const next = remapToExpiry(CHAIN, "put", "36.000000" as DecimalString, EXPIRY_B);
    expect(next).toBeNull();
  });
});
