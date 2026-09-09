import { describe, expect, it } from "vitest";
import { legRoles, legSides, legTemplateSchema, structureSchema } from "./structure";

const bullCallSpread = {
  id: "bull-call-spread",
  name: "Trava de alta",
  expiry: "shared",
  legs: [
    { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
  ],
};

const collar = {
  id: "collar",
  name: "Collar",
  expiry: "shared",
  legs: [
    { role: "stock", side: "buy", ratio: 1 },
    { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
  ],
};

describe("legTemplateSchema", () => {
  it("lists every role and side", () => {
    expect(legRoles).toEqual(["stock", "call", "put"]);
    expect(legSides).toEqual(["buy", "sell"]);
  });

  it("accepts every role with every side", () => {
    for (const role of legRoles) {
      for (const side of legSides) {
        const leg =
          role === "stock" ? { role, side, ratio: 1 } : { role, side, ratio: 1, strikeRank: 1 };
        expect(legTemplateSchema.safeParse(leg).success).toBe(true);
      }
    }
  });

  it("rejects a stock leg with a strike rank and an option leg without one", () => {
    expect(
      legTemplateSchema.safeParse({ role: "stock", side: "buy", ratio: 1, strikeRank: 1 }).success,
    ).toBe(false);
    expect(legTemplateSchema.safeParse({ role: "put", side: "buy", ratio: 1 }).success).toBe(false);
  });

  it("rejects a zero ratio", () => {
    expect(legTemplateSchema.safeParse({ role: "stock", side: "buy", ratio: 0 }).success).toBe(
      false,
    );
  });
});

describe("structureSchema", () => {
  it("accepts a trava de alta and a collar", () => {
    expect(structureSchema.parse(bullCallSpread)).toEqual(bullCallSpread);
    expect(structureSchema.parse(collar)).toEqual(collar);
  });

  it("accepts the trivial single-stock structure", () => {
    const stock = {
      id: "stock",
      name: "Stock",
      expiry: "shared",
      legs: [{ role: "stock", side: "buy", ratio: 1 }],
    };
    expect(structureSchema.safeParse(stock).success).toBe(true);
  });

  it("rejects per-leg expiries so calendars and diagonals stay out of v1", () => {
    expect(structureSchema.safeParse({ ...bullCallSpread, expiry: "per_leg" }).success).toBe(false);
    expect(
      structureSchema.safeParse({
        ...bullCallSpread,
        legs: bullCallSpread.legs.map((leg) => ({
          ...leg,
          expiry: { kind: "business_days", min: 1, max: 5 },
        })),
      }).success,
    ).toBe(false);
  });

  it("accepts legs that explicitly share a rank", () => {
    const straddle = {
      id: "straddle",
      name: "Straddle",
      expiry: "shared",
      legs: [
        { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
        { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
      ],
    };
    expect(structureSchema.safeParse(straddle).success).toBe(true);
  });

  it("rejects strike ranks with gaps or not starting at one", () => {
    const gapped = {
      ...bullCallSpread,
      legs: [
        { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
        { role: "call", side: "sell", ratio: 1, strikeRank: 3 },
      ],
    };
    expect(structureSchema.safeParse(gapped).success).toBe(false);
    expect(
      structureSchema.safeParse({
        ...bullCallSpread,
        legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 2 }],
      }).success,
    ).toBe(false);
  });

  it("rejects an empty structure and concrete tickers or strikes on legs", () => {
    expect(structureSchema.safeParse({ ...bullCallSpread, legs: [] }).success).toBe(false);
    expect(
      structureSchema.safeParse({
        ...bullCallSpread,
        legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1, ticker: "PETRJ400" }],
      }).success,
    ).toBe(false);
  });
});
