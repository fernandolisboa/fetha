import { describe, expect, it } from "vitest";
import { tickerSchema, type DecimalString, type SessionDate, type Ticker } from "@fetha/contracts";

import type { PlanLegSeries } from "./actions";
import type { PlanChainEntry } from "./chain-view";
import type { OptionLegTemplate } from "./template-legs";
import {
  currentStrikeOfRank,
  nextLegsForRankExpiry,
  nextLegsForRankStrike,
  tickersForRank,
  type RankEditContext,
} from "./rank-edit";

function decimal(value: string): DecimalString {
  return value as DecimalString;
}

function chainEntry(
  ticker: string,
  strike: string,
  expiry: SessionDate,
  right: "call" | "put",
  traded = true,
): PlanChainEntry {
  return { ticker: tickerSchema.parse(ticker), right, strike: decimal(strike), expiry, traded };
}

const EXPIRY_A = "2027-01-15" as SessionDate;
const EXPIRY_B = "2027-02-19" as SessionDate;

const UNDERLYING = tickerSchema.parse("PETR4");

const CHAIN: PlanChainEntry[] = [
  chainEntry("PETR4K36", "36.000000", EXPIRY_A, "call"),
  chainEntry("PETR4K38", "38.000000", EXPIRY_A, "call"),
  chainEntry("PETR4P36", "36.000000", EXPIRY_A, "put"),
  chainEntry("PETR4P38", "38.000000", EXPIRY_A, "put"),
  chainEntry("PETR4K37", "37.000000", EXPIRY_B, "call"),
  chainEntry("PETR4P37", "37.000000", EXPIRY_B, "put"),
];

const LONG_STRADDLE: readonly OptionLegTemplate[] = [
  { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
  { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
];

const STRADDLE_RANK = { strikeRank: 1, legIndices: [0, 1] };

function straddleContext(expiry: SessionDate | null = EXPIRY_A): RankEditContext {
  const callTicker = tickerSchema.parse("PETR4K36");
  const putTicker = tickerSchema.parse("PETR4P36");
  const series: Record<Ticker, PlanLegSeries> = {
    [callTicker]: {
      underlying: UNDERLYING,
      right: "call",
      strike: decimal("36.000000"),
      expiry: EXPIRY_A,
    },
    [putTicker]: {
      underlying: UNDERLYING,
      right: "put",
      strike: decimal("36.000000"),
      expiry: EXPIRY_A,
    },
  };
  return {
    chain: CHAIN,
    expiry,
    templateLegs: LONG_STRADDLE,
    optionFullIndices: [0, 1],
    legs: [
      { role: "call", side: "buy", ticker: callTicker },
      { role: "put", side: "buy", ticker: putTicker },
    ],
    seriesByTicker: series,
  };
}

describe("tickersForRank", () => {
  it("resolves both of a straddle's legs to the same new strike, moving them together", () => {
    const context = straddleContext();
    const updates = tickersForRank(context, STRADDLE_RANK, 38);
    expect(updates).not.toBeNull();
    expect(updates?.get(0)).toBe(tickerSchema.parse("PETR4K38"));
    expect(updates?.get(1)).toBe(tickerSchema.parse("PETR4P38"));
  });

  it("is all-or-nothing: null when only one of the rank's rights trades at the candidate strike", () => {
    const context = straddleContext();
    const lopsidedChain = CHAIN.filter((entry) => entry.ticker !== tickerSchema.parse("PETR4P38"));
    const updates = tickersForRank({ ...context, chain: lopsidedChain }, STRADDLE_RANK, 38);
    expect(updates).toBeNull();
  });
});

describe("nextLegsForRankStrike", () => {
  it("moves a long straddle's call and put together, not one leg at a time", () => {
    const context = straddleContext();
    const nextLegs = nextLegsForRankStrike(context, STRADDLE_RANK, 38);
    expect(nextLegs).not.toBeNull();
    expect(nextLegs?.map((leg) => leg.ticker)).toEqual([
      tickerSchema.parse("PETR4K38"),
      tickerSchema.parse("PETR4P38"),
    ]);
  });

  it("refuses the whole rank, leaving no leg changed, when one right has nothing at that strike", () => {
    const context = straddleContext();
    const lopsidedChain = CHAIN.filter((entry) => entry.ticker !== tickerSchema.parse("PETR4P38"));
    const nextLegs = nextLegsForRankStrike({ ...context, chain: lopsidedChain }, STRADDLE_RANK, 38);
    expect(nextLegs).toBeNull();
  });
});

describe("currentStrikeOfRank", () => {
  it("reads the rank's shared current strike off either of its legs' own listed series", () => {
    expect(currentStrikeOfRank(straddleContext(), STRADDLE_RANK)).toBe(36);
  });
});

describe("nextLegsForRankExpiry", () => {
  it("snaps a straddle's rank once and moves both legs to the new expiry together", () => {
    const nextLegs = nextLegsForRankExpiry(straddleContext(), STRADDLE_RANK, EXPIRY_B);
    expect(nextLegs).not.toBeNull();
    expect(nextLegs?.map((leg) => leg.ticker)).toEqual([
      tickerSchema.parse("PETR4K37"),
      tickerSchema.parse("PETR4P37"),
    ]);
  });

  it("refuses the remap when the target expiry trades the call but not the put at the current strike", () => {
    const chainMissingPut = CHAIN.filter(
      (entry) => entry.ticker !== tickerSchema.parse("PETR4P37"),
    );
    const nextLegs = nextLegsForRankExpiry(
      { ...straddleContext(), chain: chainMissingPut },
      STRADDLE_RANK,
      EXPIRY_B,
    );
    expect(nextLegs).toBeNull();
  });
});
