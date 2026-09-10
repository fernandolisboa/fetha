import { describe, expect, it } from "vitest";
import { quantitySchema, type ContemplatedLeg, type Structure } from "@fetha/contracts";

import type { ChainSeries } from "@/modules/market-data";

import { validateLegsAgainstStructure } from "./validate-legs";

const bullCallSpread: Structure = {
  id: "bull-call-spread",
  name: "Trava de alta com calls",
  expiry: "shared",
  legs: [
    { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
  ],
};

const ratioSpread: Structure = {
  id: "ratio-spread",
  name: "Ratio spread",
  expiry: "shared",
  legs: [
    { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "call", side: "sell", ratio: 5, strikeRank: 2 },
  ],
};

const collar: Structure = {
  id: "collar",
  name: "Collar",
  expiry: "shared",
  legs: [
    { role: "stock", side: "buy", ratio: 100 },
    { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
  ],
};

function chainSeries(overrides: Partial<ChainSeries> = {}): ChainSeries {
  return {
    ticker: "PETRA100",
    right: "call",
    strike: "28.00000000",
    expiry: "2099-01-16",
    style: "european",
    ...overrides,
  };
}

function leg(overrides: Partial<ContemplatedLeg> = {}): ContemplatedLeg {
  return {
    role: "call",
    side: "buy",
    ticker: "PETRA100",
    quantity: quantitySchema.parse(100),
    ...overrides,
  };
}

describe("validateLegsAgainstStructure", () => {
  it("accepts a bull call spread with strictly increasing strikes and matching ratio", () => {
    const chain = [
      chainSeries({ ticker: "PETRA100", strike: "28.00000000" }),
      chainSeries({ ticker: "PETRA200", strike: "30.00000000" }),
    ];
    const legs = [
      leg({ ticker: "PETRA100", side: "buy", quantity: quantitySchema.parse(100) }),
      leg({ ticker: "PETRA200", side: "sell", quantity: quantitySchema.parse(100) }),
    ];

    expect(validateLegsAgainstStructure(bullCallSpread, legs, chain)).toEqual({ ok: true });
  });

  it("rejects equal strikes across distinct strike ranks (zero-width spread)", () => {
    const chain = [
      chainSeries({ ticker: "PETRA100", strike: "28.00000000" }),
      chainSeries({ ticker: "PETRA200", strike: "28.00000000" }),
    ];
    const legs = [
      leg({ ticker: "PETRA100", side: "buy", quantity: quantitySchema.parse(100) }),
      leg({ ticker: "PETRA200", side: "sell", quantity: quantitySchema.parse(100) }),
    ];

    expect(validateLegsAgainstStructure(bullCallSpread, legs, chain)).toEqual({
      ok: false,
      reason: "strike_order",
    });
  });

  it("rejects a put strike above the call strike in a collar", () => {
    const chain = [
      chainSeries({ ticker: "PETRP100", right: "put", strike: "30.00000000" }),
      chainSeries({ ticker: "PETRA200", right: "call", strike: "28.00000000" }),
    ];
    const legs = [
      leg({ role: "stock", side: "buy", ticker: "PETR4", quantity: quantitySchema.parse(100) }),
      leg({ role: "put", side: "buy", ticker: "PETRP100", quantity: quantitySchema.parse(1) }),
      leg({ role: "call", side: "sell", ticker: "PETRA200", quantity: quantitySchema.parse(1) }),
    ];

    expect(validateLegsAgainstStructure(collar, legs, chain)).toEqual({
      ok: false,
      reason: "strike_order",
    });
  });

  it("rejects a leg with the wrong side for its template", () => {
    const chain = [
      chainSeries({ ticker: "PETRA100", strike: "28.00000000" }),
      chainSeries({ ticker: "PETRA200", strike: "30.00000000" }),
    ];
    const legs = [
      leg({ ticker: "PETRA100", side: "sell", quantity: quantitySchema.parse(100) }),
      leg({ ticker: "PETRA200", side: "sell", quantity: quantitySchema.parse(100) }),
    ];

    expect(validateLegsAgainstStructure(bullCallSpread, legs, chain)).toEqual({
      ok: false,
      reason: "leg_shape",
    });
  });

  it("rejects legs with mixed expiries", () => {
    const chain = [
      chainSeries({ ticker: "PETRA100", strike: "28.00000000", expiry: "2099-01-16" }),
      chainSeries({ ticker: "PETRA200", strike: "30.00000000", expiry: "2099-02-20" }),
    ];
    const legs = [
      leg({ ticker: "PETRA100", side: "buy", quantity: quantitySchema.parse(100) }),
      leg({ ticker: "PETRA200", side: "sell", quantity: quantitySchema.parse(100) }),
    ];

    expect(validateLegsAgainstStructure(bullCallSpread, legs, chain)).toEqual({
      ok: false,
      reason: "expiry_mismatch",
    });
  });

  it("rejects a leg-count mismatch against the template", () => {
    const chain = [chainSeries({ ticker: "PETRA100", strike: "28.00000000" })];
    const legs = [leg({ ticker: "PETRA100", side: "buy", quantity: quantitySchema.parse(100) })];

    expect(validateLegsAgainstStructure(bullCallSpread, legs, chain)).toEqual({
      ok: false,
      reason: "leg_count",
    });
  });

  it("rejects a 1x5 ratio spread saved against a 1x1 bull-call-spread template", () => {
    const chain = [
      chainSeries({ ticker: "PETRA100", strike: "28.00000000" }),
      chainSeries({ ticker: "PETRA200", strike: "30.00000000" }),
    ];
    const legs = [
      leg({ ticker: "PETRA100", side: "buy", quantity: quantitySchema.parse(100) }),
      leg({ ticker: "PETRA200", side: "sell", quantity: quantitySchema.parse(500) }),
    ];

    expect(validateLegsAgainstStructure(bullCallSpread, legs, chain)).toEqual({
      ok: false,
      reason: "leg_ratio",
    });
  });

  it("accepts a matching 1x5 ratio spread against its own ratio-spread template", () => {
    const chain = [
      chainSeries({ ticker: "PETRA100", strike: "28.00000000" }),
      chainSeries({ ticker: "PETRA200", strike: "30.00000000" }),
    ];
    const legs = [
      leg({ ticker: "PETRA100", side: "buy", quantity: quantitySchema.parse(100) }),
      leg({ ticker: "PETRA200", side: "sell", quantity: quantitySchema.parse(500) }),
    ];

    expect(validateLegsAgainstStructure(ratioSpread, legs, chain)).toEqual({ ok: true });
  });
});
