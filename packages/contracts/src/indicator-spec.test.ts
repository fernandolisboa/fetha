import { describe, expect, it } from "vitest";
import { indicatorKinds, indicatorSpecSchema } from "./indicator-spec";

describe("indicatorSpecSchema", () => {
  it("lists every indicator kind exactly once", () => {
    expect(indicatorKinds).toEqual(["sma", "ema", "rsi", "atr", "iv_rank"]);
  });

  it.each(["sma", "ema", "rsi", "atr"] as const)("accepts %s with a length", (kind) => {
    expect(indicatorSpecSchema.parse({ kind, length: 20 })).toEqual({ kind, length: 20 });
  });

  it("accepts iv_rank with lookbackSessions", () => {
    expect(indicatorSpecSchema.parse({ kind: "iv_rank", lookbackSessions: 252 })).toEqual({
      kind: "iv_rank",
      lookbackSessions: 252,
    });
  });

  it("parses every listed kind with its own parameter", () => {
    for (const kind of indicatorKinds) {
      const sample = kind === "iv_rank" ? { kind, lookbackSessions: 20 } : { kind, length: 14 };
      expect(indicatorSpecSchema.safeParse(sample).success).toBe(true);
    }
  });

  it("rejects an unknown kind", () => {
    expect(indicatorSpecSchema.safeParse({ kind: "macd", length: 12 }).success).toBe(false);
  });

  it("rejects length below one or non-integer", () => {
    expect(indicatorSpecSchema.safeParse({ kind: "sma", length: 0 }).success).toBe(false);
    expect(indicatorSpecSchema.safeParse({ kind: "sma", length: 2.5 }).success).toBe(false);
  });

  it("rejects iv_rank with fewer than two sessions or with a length", () => {
    expect(indicatorSpecSchema.safeParse({ kind: "iv_rank", lookbackSessions: 1 }).success).toBe(
      false,
    );
    expect(indicatorSpecSchema.safeParse({ kind: "iv_rank", length: 20 }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(
      indicatorSpecSchema.safeParse({ kind: "sma", length: 20, source: "close" }).success,
    ).toBe(false);
  });
});
