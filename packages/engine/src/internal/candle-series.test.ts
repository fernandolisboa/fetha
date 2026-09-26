import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Candle, CorporateActionFactor } from "../api";
import { buildCandleSeries } from "./candle-series";
import { decimalString } from "../test/support";

const candle = (
  session: string,
  close: string,
  asOf = `${session}T21:00:00.000Z`,
  tradedQuantity = 1000,
): Candle => ({
  ticker: "PETR4",
  timeframe: "D1",
  session,
  asOf,
  open: decimalString(close),
  high: decimalString(close),
  low: decimalString(close),
  close: decimalString(close),
  tradedQuantity,
});

describe("buildCandleSeries", () => {
  it("leaves candles before any ex-date unadjusted when there is no factor", () => {
    const candles = [candle("2024-01-02", "10.00"), candle("2024-01-03", "11.00")];
    const result = buildCandleSeries({
      candles,
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-03T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted.map((c) => c.close)).toEqual(["10.00", "11.00"]);
    expect(result.value.nominal.map((c) => c.close)).toEqual(["10.00", "11.00"]);
  });

  it("multiplies sessions strictly before the ex-date by the visible factor, leaving the ex-date session and after untouched", () => {
    const candles = [
      candle("2024-01-02", "10.00"),
      candle("2024-01-03", "5.10"),
      candle("2024-01-04", "5.20"),
    ];
    const factor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-03T13:00:00.000Z",
      factor: decimalString("0.5"),
    };
    const result = buildCandleSeries({
      candles,
      corporateActions: [factor],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-04T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted.map((c) => c.close)).toEqual(["5.00", "5.10", "5.20"]);
    expect(result.value.nominal.map((c) => c.close)).toEqual(["10.00", "5.10", "5.20"]);
  });

  it("doubles tradedQuantity for sessions before a 2-for-1 split, leaving the ex-date session and after untouched", () => {
    const candles = [
      candle("2024-01-02", "10.00", undefined, 1000),
      candle("2024-01-03", "5.10", undefined, 2000),
      candle("2024-01-04", "5.20", undefined, 2100),
    ];
    const factor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-03T13:00:00.000Z",
      factor: decimalString("0.5"),
    };
    const result = buildCandleSeries({
      candles,
      corporateActions: [factor],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-04T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted.map((c) => c.tradedQuantity)).toEqual([2000, 2000, 2100]);
    expect(result.value.nominal.map((c) => c.tradedQuantity)).toEqual([1000, 2000, 2100]);
  });

  it("divides tradedQuantity by a 1-for-10 reverse split's factor, rounding a tie half up", () => {
    const candles = [
      candle("2024-01-02", "1.00", undefined, 1000),
      candle("2024-01-03", "1.00", undefined, 1005),
    ];
    const factor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-04",
      asOf: "2024-01-03T13:00:00.000Z",
      factor: decimalString("10"),
    };
    const result = buildCandleSeries({
      candles,
      corporateActions: [factor],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-04T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted.map((c) => c.tradedQuantity)).toEqual([100, 101]);
    expect(result.value.adjusted.map((c) => c.close)).toEqual(["10.00", "10.00"]);
  });

  it("scales tradedQuantity by the product of every visible factor after the session", () => {
    const candles = [
      candle("2024-01-02", "10.00", undefined, 1000),
      candle("2024-01-03", "5.00", undefined, 1000),
      candle("2024-01-04", "2.50", undefined, 1000),
    ];
    const factorOn = (exDate: string): CorporateActionFactor => ({
      ticker: "PETR4",
      exDate,
      asOf: `${exDate}T13:00:00.000Z`,
      factor: decimalString("0.5"),
    });
    const result = buildCandleSeries({
      candles,
      corporateActions: [factorOn("2024-01-03"), factorOn("2024-01-04")],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-04T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted.map((c) => c.tradedQuantity)).toEqual([4000, 2000, 1000]);
    expect(result.value.adjusted.map((c) => c.close)).toEqual(["2.50", "2.50", "2.50"]);
  });

  it("rounds a non-integer scaled tradedQuantity half up, breaking exact ties upward", () => {
    const candles = [candle("2024-01-02", "10.00", undefined, 1)];
    const factor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-02T13:00:00.000Z",
      factor: decimalString("0.4"),
    };
    const result = buildCandleSeries({
      candles,
      corporateActions: [factor],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted[0]?.tradedQuantity).toBe(3);
  });

  it("keeps the adjusted tradedQuantity an integer for a factor product with a longer decimal expansion", () => {
    const candles = [candle("2024-01-02", "10.00", undefined, 1000)];
    const factor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-02T13:00:00.000Z",
      factor: decimalString("0.6"),
    };
    const result = buildCandleSeries({
      candles,
      corporateActions: [factor],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted[0]?.tradedQuantity).toBe(1667);
    expect(Number.isInteger(result.value.adjusted[0]?.tradedQuantity)).toBe(true);
  });

  it("keeps the financial-value-like invariant: adjusted price times adjusted quantity approximates nominal price times nominal quantity", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 100_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.oneof(fc.integer({ min: 10, max: 900 }), fc.integer({ min: 1100, max: 20_000 })),
        (closeCents, tradedQuantity, factorThousandths) => {
          const close = (closeCents / 100).toFixed(2);
          const factor = (factorThousandths / 1000).toFixed(3);
          const candles = [candle("2024-01-02", close, undefined, tradedQuantity)];
          const corporateAction: CorporateActionFactor = {
            ticker: "PETR4",
            exDate: "2024-01-03",
            asOf: "2024-01-02T13:00:00.000Z",
            factor: decimalString(factor),
          };
          const result = buildCandleSeries({
            candles,
            corporateActions: [corporateAction],
            ticker: "PETR4",
            timeframe: "D1",
            at: "2024-01-02T23:00:00.000Z",
          });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const adjusted = result.value.adjusted[0];
          if (!adjusted) throw new Error("expected one adjusted candle");
          const nominalValue = Number(close) * tradedQuantity;
          const adjustedValue = Number(adjusted.close) * adjusted.tradedQuantity;
          const tolerance = 0.5 * Number(adjusted.close) + 0.005 * adjusted.tradedQuantity + 0.01;
          expect(Math.abs(adjustedValue - nominalValue)).toBeLessThanOrEqual(tolerance);
        },
      ),
    );
  });

  it("ignores a factor whose asOf is after the truncation instant (I1)", () => {
    const candles = [candle("2024-01-02", "10.00"), candle("2024-01-03", "5.10")];
    const factor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-05T13:00:00.000Z",
      factor: decimalString("0.5"),
    };
    const result = buildCandleSeries({
      candles,
      corporateActions: [factor],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-03T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted.map((c) => c.close)).toEqual(["10.00", "5.10"]);
  });

  it("drops candles with asOf after the truncation instant and reports them", () => {
    const candles = [candle("2024-01-02", "10.00"), candle("2024-01-03", "11.00")];
    const result = buildCandleSeries({
      candles,
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted.map((c) => c.session)).toEqual(["2024-01-02"]);
    expect(result.value.truncated).toContainEqual({
      collection: "candles",
      ticker: "PETR4",
      dropped: 1,
      reason: "after_at",
    });
  });

  it("drops candles for other instruments and reports them as unreferenced", () => {
    const candles = [
      candle("2024-01-02", "10.00"),
      { ...candle("2024-01-02", "50.00"), ticker: "VALE3" },
    ];
    const result = buildCandleSeries({
      candles,
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted).toHaveLength(1);
    expect(result.value.truncated).toContainEqual({
      collection: "candles",
      ticker: "VALE3",
      dropped: 1,
      reason: "unreferenced_instrument",
    });
  });

  it("ignores candles of a different timeframe without reporting them", () => {
    const candles = [
      candle("2024-01-02", "10.00"),
      { ...candle("2024-01-02", "10.00"), timeframe: "60m" as const },
    ];
    const result = buildCandleSeries({
      candles,
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted).toHaveLength(1);
    expect(result.value.truncated).toEqual([]);
  });

  it("counts an unreferenced-instrument row as unreferenced regardless of its timeframe, in a mixed-timeframe view", () => {
    const candles = [
      candle("2024-01-02", "10.00"),
      { ...candle("2024-01-02", "20.00"), ticker: "VALE3" },
      { ...candle("2024-01-02", "30.00"), ticker: "VALE3", timeframe: "60m" as const },
      { ...candle("2024-01-02", "10.00"), timeframe: "60m" as const },
    ];
    const result = buildCandleSeries({
      candles,
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adjusted).toHaveLength(1);
    expect(result.value.truncated).toContainEqual({
      collection: "candles",
      ticker: "VALE3",
      dropped: 2,
      reason: "unreferenced_instrument",
    });
  });

  it("drops corporate action factors after the truncation instant and for other instruments, reporting both", () => {
    const candles = [candle("2024-01-02", "10.00")];
    const factors: CorporateActionFactor[] = [
      {
        ticker: "PETR4",
        exDate: "2024-01-05",
        asOf: "2024-01-05T13:00:00.000Z",
        factor: decimalString("0.5"),
      },
      {
        ticker: "VALE3",
        exDate: "2024-01-02",
        asOf: "2024-01-02T13:00:00.000Z",
        factor: decimalString("0.5"),
      },
    ];
    const result = buildCandleSeries({
      candles,
      corporateActions: factors,
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).toContainEqual({
      collection: "corporateActions",
      ticker: "PETR4",
      dropped: 1,
      reason: "after_at",
    });
    expect(result.value.truncated).toContainEqual({
      collection: "corporateActions",
      ticker: "VALE3",
      dropped: 1,
      reason: "unreferenced_instrument",
    });
  });

  it("rejects duplicate corporate action factor keys as invalid input", () => {
    const candles = [candle("2024-01-02", "10.00")];
    const factors: CorporateActionFactor[] = [
      {
        ticker: "PETR4",
        exDate: "2024-01-03",
        asOf: "2024-01-03T13:00:00.000Z",
        factor: decimalString("0.5"),
      },
      {
        ticker: "PETR4",
        exDate: "2024-01-03",
        asOf: "2024-01-03T14:00:00.000Z",
        factor: decimalString("0.6"),
      },
    ];
    const result = buildCandleSeries({
      candles,
      corporateActions: factors,
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-03T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate candle keys as invalid input", () => {
    const candles = [candle("2024-01-02", "10.00"), candle("2024-01-02", "10.50")];
    const result = buildCandleSeries({
      candles,
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects two candle rows for the same instant expressed with different millisecond precision as a duplicate key", () => {
    const candles = [
      candle("2024-01-02", "10.00", "2024-01-02T20:00:00Z"),
      candle("2024-01-02", "10.50", "2024-01-02T20:00:00.000Z"),
    ];
    const result = buildCandleSeries({
      candles,
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("compares asOf chronologically, not lexicographically, across mixed millisecond precision", () => {
    const candles = [candle("2024-01-02", "10.00", "2024-01-02T20:00:00Z")];
    const result = buildCandleSeries({
      candles,
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T20:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nominal).toHaveLength(1);
    expect(result.value.truncated).toEqual([]);
  });

  it("keeps a candle whose asOf equals at visible and not truncated (asOf === at is not after at)", () => {
    const candles = [candle("2024-01-02", "10.00", "2024-01-02T20:00:00.000Z")];
    const result = buildCandleSeries({
      candles,
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T20:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nominal).toHaveLength(1);
    expect(result.value.truncated).toEqual([]);
  });

  it("keeps a factor whose asOf equals the truncation instant visible and not truncated", () => {
    const candles = [candle("2024-01-02", "10.00", "2024-01-02T13:00:00.000Z")];
    const factor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-02T20:00:00.000Z",
      factor: decimalString("0.5"),
    };
    const result = buildCandleSeries({
      candles,
      corporateActions: [factor],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T20:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).toEqual([]);
  });

  it("rejects a non-positive corporate-action factor as invalid_input at the factor's own path", () => {
    const candles = [candle("2024-01-02", "10.00")];
    const factors: CorporateActionFactor[] = [
      {
        ticker: "PETR4",
        exDate: "2024-01-03",
        asOf: "2024-01-02T13:00:00.000Z",
        factor: decimalString("1"),
      },
      {
        ticker: "VALE3",
        exDate: "2024-01-03",
        asOf: "2024-01-02T13:00:00.000Z",
        factor: decimalString("0"),
      },
    ];
    const result = buildCandleSeries({
      candles,
      corporateActions: factors,
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-03T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("view.corporateActions[1].factor");
  });

  it("rejects a negative corporate-action factor as invalid_input", () => {
    const candles = [candle("2024-01-02", "10.00")];
    const factors: CorporateActionFactor[] = [
      {
        ticker: "PETR4",
        exDate: "2024-01-03",
        asOf: "2024-01-02T13:00:00.000Z",
        factor: decimalString("-0.5"),
      },
    ];
    const result = buildCandleSeries({
      candles,
      corporateActions: factors,
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-03T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("view.corporateActions[0].factor");
  });

  it("reports unreferenced-instrument drops in a deterministic, ticker-sorted order regardless of input order", () => {
    const candles = [
      candle("2024-01-02", "10.00"),
      { ...candle("2024-01-02", "20.00"), ticker: "VALE3" },
      { ...candle("2024-01-02", "30.00"), ticker: "ABEV3" },
    ];
    const result = buildCandleSeries({
      candles,
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const otherTickers = result.value.truncated
      .filter((t) => t.reason === "unreferenced_instrument")
      .map((t) => t.ticker);
    expect(otherTickers).toEqual(["ABEV3", "VALE3"]);
  });

  it("rejects a candle with a non-positive close as invalid_input", () => {
    const badCandle = { ...candle("2024-01-02", "10.00"), close: decimalString("0.00") };
    const result = buildCandleSeries({
      candles: [badCandle],
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      path: "view.candles[0].close",
      message: "a candle's open, high, low and close must be strictly positive",
    });
  });

  it("rejects a candle with a negative open as invalid_input", () => {
    const badCandle = { ...candle("2024-01-02", "10.00"), open: decimalString("-1.00") };
    const result = buildCandleSeries({
      candles: [badCandle],
      corporateActions: [],
      ticker: "PETR4",
      timeframe: "D1",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("view.candles[0].open");
  });
});
