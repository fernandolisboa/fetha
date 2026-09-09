import { describe, expect, it } from "vitest";
import type { Candle, ImpliedVolatilityIndexPoint, IndicatorsInput } from "../api";
import { computeIndicators } from "./indicators-computation";
import { decimalString } from "./test-support";

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
