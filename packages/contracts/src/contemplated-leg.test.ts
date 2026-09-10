import { describe, expect, it } from "vitest";
import { contemplatedLegSchema } from "./contemplated-leg";

describe("contemplatedLegSchema", () => {
  it("accepts a concrete leg with a ticker and a positive quantity", () => {
    const result = contemplatedLegSchema.safeParse({
      role: "call",
      side: "buy",
      ticker: "PETRJ400",
      quantity: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a strikeRank field: legs are concrete, not templated", () => {
    const result = contemplatedLegSchema.safeParse({
      role: "call",
      side: "buy",
      ticker: "PETRJ400",
      quantity: 1,
      strikeRank: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    const result = contemplatedLegSchema.safeParse({
      role: "stock",
      side: "buy",
      ticker: "PETR4",
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });
});
