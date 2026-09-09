import { describe, expect, it } from "vitest";
import { thesisClaimKinds, thesisClaimSchema } from "./thesis-claim";

describe("thesisClaimSchema", () => {
  it("lists every claim kind", () => {
    expect(thesisClaimKinds).toEqual(["close_above", "close_below", "operation_pnl_positive"]);
  });

  it("parses every listed kind", () => {
    const samples = {
      close_above: { kind: "close_above", instrument: "PETR4", level: "40.00" },
      close_below: { kind: "close_below", instrument: "PETR4", level: "35.00" },
      operation_pnl_positive: { kind: "operation_pnl_positive" },
    } satisfies Record<(typeof thesisClaimKinds)[number], unknown>;
    for (const kind of thesisClaimKinds) {
      expect(thesisClaimSchema.safeParse(samples[kind]).success).toBe(true);
    }
  });

  it("rejects unknown kinds, invalid tickers and numeric levels", () => {
    expect(thesisClaimSchema.safeParse({ kind: "iv_falls", instrument: "PETR4" }).success).toBe(
      false,
    );
    expect(
      thesisClaimSchema.safeParse({ kind: "close_above", instrument: "petr4", level: "40" })
        .success,
    ).toBe(false);
    expect(
      thesisClaimSchema.safeParse({ kind: "close_above", instrument: "PETR4", level: 40 }).success,
    ).toBe(false);
  });

  it("rejects free text", () => {
    expect(thesisClaimSchema.safeParse("PETR4 will rally").success).toBe(false);
    expect(
      thesisClaimSchema.safeParse({ kind: "operation_pnl_positive", rationale: "x" }).success,
    ).toBe(false);
  });
});
