import { describe, expect, it } from "vitest";
import { operationLegSchema } from "./operation-leg";

describe("operationLegSchema", () => {
  it("accepts a concrete leg with a ticker and a positive quantity", () => {
    const result = operationLegSchema.safeParse({
      role: "call",
      side: "buy",
      ticker: "PETRJ400",
      quantity: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a strikeRank field: legs are concrete, not templated", () => {
    const result = operationLegSchema.safeParse({
      role: "call",
      side: "buy",
      ticker: "PETRJ400",
      quantity: 1,
      strikeRank: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    const result = operationLegSchema.safeParse({
      role: "stock",
      side: "buy",
      ticker: "PETR4",
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });
});
