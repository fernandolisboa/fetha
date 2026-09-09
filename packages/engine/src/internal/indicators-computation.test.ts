import { describe, expect, it } from "vitest";
import type { Candle, ImpliedVolatilityIndexPoint, IndicatorsInput } from "../api";
import { computeIndicators } from "./indicators-computation";
import { decimalString } from "../test/support";

const candle = (session: string, close: string): Candle => ({
  ticker: "PETR4",
  timeframe: "D1",
  session,
  asOf: `${session}T21:00:00.000Z`,
  open: decimalString(close),
  high: decimalString(close),
  low: decimalString(close),
  close: decimalString(close),
  tradedQuantity: 1000,
});

const emptyView: IndicatorsInput["view"] = {
  calendar: [],
  candles: [],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

describe("computeIndicators", () => {
  it("computes SMA over the adjusted close and reports warm-up as null", () => {
    const candles = [
      candle("2024-01-02", "10.00"),
      candle("2024-01-03", "11.00"),
      candle("2024-01-04", "12.00"),
    ];
    const result = computeIndicators({
      view: { ...emptyView, candles },
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "sma", length: 2 }],
      at: "2024-01-04T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.series).toEqual([
      { indicator: { kind: "sma", length: 2 }, values: [null, "10.50", "11.50"] },
    ]);
    expect(result.value.form).toBe("adjusted");
    expect(result.value.candles).toHaveLength(3);
    expect(result.value.provenance.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("returns nominal candles when form is nominal, but still computes indicators on the adjusted series", () => {
    const candles = [candle("2024-01-02", "10.00"), candle("2024-01-03", "5.00")];
    const result = computeIndicators({
      view: {
        ...emptyView,
        candles,
        corporateActions: [
          {
            ticker: "PETR4",
            exDate: "2024-01-03",
            asOf: "2024-01-03T13:00:00.000Z",
            factor: decimalString("0.5"),
          },
        ],
      },
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "sma", length: 2 }],
      at: "2024-01-03T23:00:00.000Z",
      form: "nominal",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candles.map((c) => c.close)).toEqual(["10.00", "5.00"]);
    expect(result.value.series).toEqual([
      { indicator: { kind: "sma", length: 2 }, values: [null, "5.00"] },
    ]);
  });

  it("computes iv_rank aligned to each candle session from the implied-volatility index", () => {
    const candles = [
      candle("2024-01-02", "10.00"),
      candle("2024-01-03", "10.00"),
      candle("2024-01-04", "10.00"),
    ];
    const point = (session: string, iv: string): ImpliedVolatilityIndexPoint => ({
      underlying: "PETR4",
      session,
      asOf: `${session}T21:00:00.000Z`,
      impliedVolatility: decimalString(iv),
    });
    const result = computeIndicators({
      view: {
        ...emptyView,
        candles,
        impliedVolatilityIndex: [
          point("2024-01-02", "0.10"),
          point("2024-01-03", "0.30"),
          point("2024-01-04", "0.20"),
        ],
      },
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "iv_rank", lookbackSessions: 3 }],
      at: "2024-01-04T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // window [0.10, 0.30, 0.20], current 0.20: below = {0.10} -> 100*1/2 = 50
    expect(result.value.series).toEqual([
      { indicator: { kind: "iv_rank", lookbackSessions: 3 }, values: [null, null, "50.000000"] },
    ]);
  });

  it("aligns intraday iv_rank to the latest IV point with asOf <= candle.asOf, never a same-session point published at the close", () => {
    const midSessionCandle: Candle = {
      ticker: "PETR4",
      timeframe: "15m",
      session: "2024-01-02",
      asOf: "2024-01-02T14:15:00.000Z",
      open: decimalString("10.00"),
      high: decimalString("10.00"),
      low: decimalString("10.00"),
      close: decimalString("10.00"),
      tradedQuantity: 100,
    };
    const points: ImpliedVolatilityIndexPoint[] = [
      {
        underlying: "PETR4",
        session: "2024-01-01",
        asOf: "2024-01-01T21:00:00.000Z",
        impliedVolatility: decimalString("0.10"),
      },
      {
        underlying: "PETR4",
        session: "2024-01-02",
        asOf: "2024-01-02T21:00:00.000Z",
        impliedVolatility: decimalString("0.90"),
      },
    ];
    const result = computeIndicators({
      view: { ...emptyView, candles: [midSessionCandle], impliedVolatilityIndex: points },
      ticker: "PETR4",
      timeframe: "15m",
      indicators: [{ kind: "iv_rank", lookbackSessions: 2 }],
      at: "2024-01-02T21:05:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the prior-session point (0.10) is visible at 14:15; the same-session
    // point published at 21:00 must not apply, so with a single visible point and
    // lookbackSessions = 2 the rank is still null.
    expect(result.value.series).toEqual([
      { indicator: { kind: "iv_rank", lookbackSessions: 2 }, values: [null] },
    ]);
  });

  it("rejects an indicator length below 1 as invalid_input, without NaN or a throw", () => {
    const result = computeIndicators({
      view: emptyView,
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "sma", length: 0 }],
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "indicators[0].length",
      message: "length must be at least 1",
    });
  });

  it("rejects an iv_rank lookbackSessions below 2 as invalid_input, without NaN or a throw", () => {
    const result = computeIndicators({
      view: emptyView,
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "iv_rank", lookbackSessions: 1 }],
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "indicators[0].lookbackSessions",
      message: "lookbackSessions must be at least 2",
    });
  });

  it("rejects a duplicate implied-volatility index point as invalid_input", () => {
    const candles = [candle("2024-01-02", "10.00")];
    const point = (session: string, iv: string): ImpliedVolatilityIndexPoint => ({
      underlying: "PETR4",
      session,
      asOf: `${session}T21:00:00.000Z`,
      impliedVolatility: decimalString(iv),
    });
    const result = computeIndicators({
      view: {
        ...emptyView,
        candles,
        impliedVolatilityIndex: [point("2024-01-02", "0.10"), point("2024-01-02", "0.20")],
      },
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "iv_rank", lookbackSessions: 2 }],
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("rejects a duplicate candle row as invalid_input", () => {
    const candles = [candle("2024-01-02", "10.00"), candle("2024-01-02", "11.00")];
    const result = computeIndicators({
      view: { ...emptyView, candles },
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "sma", length: 2 }],
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("computes RSI and ATR alongside SMA/EMA in one call", () => {
    const candles = [
      candle("2024-01-02", "10.00"),
      candle("2024-01-03", "11.00"),
      candle("2024-01-04", "12.00"),
      candle("2024-01-05", "11.50"),
    ];
    const result = computeIndicators({
      view: { ...emptyView, candles },
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [
        { kind: "ema", length: 2 },
        { kind: "rsi", length: 2 },
        { kind: "atr", length: 2 },
      ],
      at: "2024-01-05T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.series).toHaveLength(3);
    for (const s of result.value.series) {
      expect(s.values).toHaveLength(4);
    }
  });

  it("copies dataVersion and datasetNotes into provenance", () => {
    const result = computeIndicators({
      view: { ...emptyView, dataVersion: "2024-01-04", datasetNotes: ["b3 cotahist"] },
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "sma", length: 2 }],
      at: "2024-01-04T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance.dataVersion).toBe("2024-01-04");
    expect(result.value.provenance.datasetNotes).toEqual(["b3 cotahist"]);
  });

  it("defaults dataVersion to null and datasetNotes to an empty array when absent", () => {
    const result = computeIndicators({
      view: emptyView,
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "sma", length: 2 }],
      at: "2024-01-04T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance.dataVersion).toBeNull();
    expect(result.value.provenance.datasetNotes).toEqual([]);
  });
});
