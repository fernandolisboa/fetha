import { describe, expect, it } from "vitest";
import type { Candle, CorporateActionFactor } from "../api";
import { buildCandleSeries } from "./candle-series";
import { decimalString } from "../test/support";

const candle = (session: string, close: string, asOf = `${session}T21:00:00.000Z`): Candle => ({
  ticker: "PETR4",
  timeframe: "D1",
  session,
  asOf,
  open: decimalString(close),
  high: decimalString(close),
  low: decimalString(close),
  close: decimalString(close),
  tradedQuantity: 1000,
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
});
