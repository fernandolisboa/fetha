import Decimal from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  Candle,
  ImpliedVolatilityIndexPoint,
  MarketView,
  OptionDayPrice,
  OptionSeries,
  TradingSession,
} from "../api";
import { assetReadingThresholds } from "../api";
import { decimalString } from "../test/support";
import {
  classifyImpliedVolatility,
  classifyMomentum,
  classifyOptionLiquidity,
  classifyRange,
  classifyTrend,
  computeAssetReading,
} from "./asset-reading";

const provenanceBase = {
  engineVersion: "0.0.0-test",
  pricingModel: "bsm_continuous_yield" as const,
  dataVersion: null,
  datasetNotes: [] as string[],
};

const emptyView: MarketView = {
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

const sessionAt = (index: number): string => {
  const d = new Date(Date.UTC(2024, 0, 1 + index));
  return d.toISOString().slice(0, 10);
};

const dailyCandle = (
  ticker: string,
  index: number,
  close: string,
  high = close,
  low = close,
): Candle => {
  const session = sessionAt(index);
  return {
    ticker,
    timeframe: "D1",
    session,
    asOf: `${session}T21:00:00.000Z`,
    open: decimalString(close),
    high: decimalString(high),
    low: decimalString(low),
    close: decimalString(close),
    tradedQuantity: 1000,
  };
};

const calendarSessions = (count: number): TradingSession[] =>
  Array.from({ length: count }, (_, i) => {
    const session = sessionAt(i);
    return { date: session, open: `${session}T13:00:00.000Z`, close: `${session}T21:00:00.000Z` };
  });

describe("classifyTrend (ADR-0059)", () => {
  it("is up when close and SMA50 both sit above SMA200, in that order", () => {
    expect(classifyTrend(decimalString("12"), decimalString("11"), decimalString("10"))).toBe("up");
  });

  it("is down when close and SMA50 both sit below SMA200, in that order", () => {
    expect(classifyTrend(decimalString("8"), decimalString("9"), decimalString("10"))).toBe("down");
  });

  it("is sideways on a tie at either boundary", () => {
    expect(classifyTrend(decimalString("10"), decimalString("10"), decimalString("10"))).toBe(
      "sideways",
    );
    expect(classifyTrend(decimalString("11"), decimalString("10"), decimalString("10"))).toBe(
      "sideways",
    );
  });

  it("is null when either SMA is unavailable", () => {
    expect(classifyTrend(decimalString("10"), null, decimalString("9"))).toBeNull();
    expect(classifyTrend(decimalString("10"), decimalString("9"), null)).toBeNull();
  });
});

describe("classifyMomentum, classifyRange and classifyImpliedVolatility (ADR-0059 boundaries)", () => {
  it("reads oversold/overbought inclusively at 30/70, neutral strictly inside", () => {
    expect(classifyMomentum(decimalString("30"))).toBe("oversold");
    expect(classifyMomentum(decimalString("29.999999"))).toBe("oversold");
    expect(classifyMomentum(decimalString("70"))).toBe("overbought");
    expect(classifyMomentum(decimalString("70.000001"))).toBe("overbought");
    expect(classifyMomentum(decimalString("50"))).toBe("neutral");
    expect(classifyMomentum(null)).toBeNull();
  });

  it("reads calm/wide inclusively at 1.5%/3.5%, normal strictly inside", () => {
    expect(classifyRange(decimalString("0.015"))).toBe("calm");
    expect(classifyRange(decimalString("0.035"))).toBe("wide");
    expect(classifyRange(decimalString("0.02"))).toBe("normal");
    expect(classifyRange(null)).toBeNull();
  });

  it("reads low/high inclusively at 30/70, normal strictly inside", () => {
    expect(classifyImpliedVolatility(decimalString("30"))).toBe("low");
    expect(classifyImpliedVolatility(decimalString("70"))).toBe("high");
    expect(classifyImpliedVolatility(decimalString("50"))).toBe("normal");
    expect(classifyImpliedVolatility(null)).toBeNull();
  });

  it("property: every boundary is monotone and inclusive on its extreme side", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (hundredths) => {
        const value = new Decimal(hundredths).div(100).toFixed(2);
        const label = classifyMomentum(decimalString(value));
        const n = new Decimal(value);
        if (n.lte(assetReadingThresholds.rsiOversold)) expect(label).toBe("oversold");
        else if (n.gte(assetReadingThresholds.rsiOverbought)) expect(label).toBe("overbought");
        else expect(label).toBe("neutral");
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (hundredths) => {
        const value = new Decimal(hundredths).div(100).toFixed(2);
        const label = classifyImpliedVolatility(decimalString(value));
        const n = new Decimal(value);
        if (n.lte(assetReadingThresholds.ivRankLow)) expect(label).toBe("low");
        else if (n.gte(assetReadingThresholds.ivRankHigh)) expect(label).toBe("high");
        else expect(label).toBe("normal");
      }),
    );
  });
});

describe("classifyOptionLiquidity (ADR-0059)", () => {
  it("is none at zero, thin from one, liquid from ten inclusive", () => {
    expect(classifyOptionLiquidity(0)).toBe("none");
    expect(classifyOptionLiquidity(1)).toBe("thin");
    expect(classifyOptionLiquidity(9)).toBe("thin");
    expect(classifyOptionLiquidity(10)).toBe("liquid");
    expect(classifyOptionLiquidity(11)).toBe("liquid");
  });

  it("property: monotone in the traded series count", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        const label = classifyOptionLiquidity(n);
        if (n === 0) expect(label).toBe("none");
        else if (n < assetReadingThresholds.liquidTradedSeries) expect(label).toBe("thin");
        else expect(label).toBe("liquid");
      }),
    );
  });
});

describe("computeAssetReading — no candle (#304)", () => {
  it("still returns ok:true with every candle-based reading null", () => {
    const result = computeAssetReading(
      emptyView,
      "PETR4",
      "2024-01-01T21:00:00.000Z",
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session).toBeNull();
    expect(result.value.close).toBeNull();
    expect(result.value.trend).toEqual({ label: null, smaShort: null, smaLong: null });
    expect(result.value.momentum).toEqual({ label: null, rsi: null });
    expect(result.value.range).toEqual({ label: null, atr: null, atrShare: null });
  });

  it("still fills the options block from a calendar fallback session when there is no candle", () => {
    const calendar = calendarSessions(3);
    const view: MarketView = {
      ...emptyView,
      calendar,
      optionSeries: [
        {
          ticker: "PETRA100",
          underlying: "PETR4",
          right: "call",
          strike: decimalString("10"),
          expiry: sessionAt(10),
          style: "european",
          asOf: calendar[2]?.open ?? "",
        },
      ],
    };
    const result = computeAssetReading(view, "PETR4", calendar[2]?.close ?? "", provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options.session).toBe(sessionAt(2));
    expect(result.value.options.tradedSeries).toBe(0);
    expect(result.value.options.label).toBe("none");
  });
});

describe("computeAssetReading — trend over a monotonic rising series (#304)", () => {
  it("reads SMA50/SMA200 and labels the trend up once both windows are full", () => {
    const count = 210;
    const closes = Array.from({ length: count }, (_, i) => (100 + i * 0.01).toFixed(2));
    const candles = closes.map((close, i) => dailyCandle("PETR4", i, close));
    const view: MarketView = { ...emptyView, candles };
    const at = candles[count - 1]?.asOf ?? "";

    const result = computeAssetReading(view, "PETR4", at, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.close).toBe(closes[count - 1]);
    expect(result.value.trend.smaLong).toBe("101.10");
    expect(result.value.trend.smaShort).toBe("101.85");
    expect(result.value.trend.label).toBe("up");
  });
});

describe("computeAssetReading — short history (#304)", () => {
  it("nulls trend, momentum and range when there are too few candles for any of them", () => {
    const candles = Array.from({ length: 10 }, (_, i) => dailyCandle("PETR4", i, "40.00"));
    const view: MarketView = { ...emptyView, candles };
    const at = candles[9]?.asOf ?? "";
    const result = computeAssetReading(view, "PETR4", at, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session).toBe(sessionAt(9));
    expect(result.value.close).toBe("40.00");
    expect(result.value.trend).toEqual({ label: null, smaShort: null, smaLong: null });
    expect(result.value.momentum).toEqual({ label: null, rsi: null });
    expect(result.value.range).toEqual({ label: null, atr: null, atrShare: null });
  });
});

describe("computeAssetReading — Wilder RSI(14) reference series (#304)", () => {
  // StockCharts.org RSI ChartSchool example, also reproduced in anandanand84/technicalindicators
  // test fixtures and in rsi.test.ts: the 17th close gives RSI(14) = 66.48.
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
    46.28, 46.0, 46.03,
  ];

  it("matches the published reference value and classifies momentum from it", () => {
    const candles = closes.map((close, i) => dailyCandle("PETR4", i, close.toFixed(2)));
    const view: MarketView = { ...emptyView, candles };
    const at = candles[closes.length - 1]?.asOf ?? "";
    const result = computeAssetReading(view, "PETR4", at, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Decimal(result.value.momentum.rsi ?? "0").toDecimalPlaces(2).toString()).toBe(
      "66.48",
    );
    expect(result.value.momentum.label).toBe("neutral");
  });
});

describe("computeAssetReading — Wilder ATR(14) reference series (#304)", () => {
  // StockCharts.org ATR ChartSchool example, also reproduced in atr.test.ts: the 15th bar gives
  // ATR(14) = 0.57 (two decimal places).
  const high = [
    48.7, 48.72, 48.9, 48.87, 48.82, 49.05, 49.2, 49.35, 49.92, 50.19, 50.12, 49.66, 49.88, 50.19,
    50.36,
  ];
  const low = [
    47.79, 48.14, 48.39, 48.37, 48.24, 48.64, 48.94, 48.86, 49.5, 49.87, 49.2, 48.9, 49.43, 49.73,
    49.26,
  ];
  const close = [
    48.16, 48.61, 48.75, 48.63, 48.74, 49.03, 49.07, 49.32, 49.91, 50.13, 49.53, 49.5, 49.75, 50.03,
    50.31,
  ];

  it("matches the published reference value and reports an ATR share", () => {
    const candles = high.map((h, i) =>
      dailyCandle("PETR4", i, (close[i] ?? 0).toFixed(2), h.toFixed(2), (low[i] ?? 0).toFixed(2)),
    );
    const view: MarketView = { ...emptyView, candles };
    const at = candles[high.length - 1]?.asOf ?? "";
    const result = computeAssetReading(view, "PETR4", at, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.range.atr).not.toBeNull();
    expect(new Decimal(result.value.range.atr ?? "0").toDecimalPlaces(2).toString()).toBe("0.57");
    const expectedShare = new Decimal(result.value.range.atr ?? "0").div(result.value.close ?? "1");
    expect(result.value.range.atrShare).toBe(expectedShare.toFixed(6));
  });
});

describe("computeAssetReading — implied volatility (#304)", () => {
  const ivPoint = (index: number, impliedVolatility: string): ImpliedVolatilityIndexPoint => ({
    underlying: "PETR4",
    session: sessionAt(index),
    asOf: `${sessionAt(index)}T21:00:00.000Z`,
    impliedVolatility: decimalString(impliedVolatility),
  });

  it("reads the latest point but nulls ivRank short of a full 252-session window", () => {
    const points = Array.from({ length: 5 }, (_, i) => ivPoint(i, (0.3 + i * 0.01).toFixed(4)));
    const calendar = calendarSessions(5);
    const view: MarketView = { ...emptyView, calendar, impliedVolatilityIndex: points };
    const at = calendar[4]?.close ?? "";
    const result = computeAssetReading(view, "PETR4", at, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impliedVolatility.latest).toEqual({
      session: sessionAt(4),
      impliedVolatility: points[4]?.impliedVolatility,
    });
    expect(result.value.impliedVolatility.ivRank).toBeNull();
    expect(result.value.impliedVolatility.label).toBeNull();
  });

  it("ranks the latest point once a full 252-session window is visible", () => {
    const count = 252;
    const points = Array.from({ length: count }, (_, i) =>
      ivPoint(i, (0.2 + (i / count) * 0.2).toFixed(4)),
    );
    const calendar = calendarSessions(count);
    const view: MarketView = { ...emptyView, calendar, impliedVolatilityIndex: points };
    const at = calendar[count - 1]?.close ?? "";
    const result = computeAssetReading(view, "PETR4", at, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Strictly increasing values over the whole window: every earlier point is below the latest,
    // so iv_rank is 100 (ivRank's own formula, reference-tested in iv-rank.test.ts).
    expect(result.value.impliedVolatility.ivRank).toBe("100.000000");
    expect(result.value.impliedVolatility.label).toBe("high");
  });
});

describe("computeAssetReading — options block (#304)", () => {
  const callSeries = (
    ticker: string,
    expiry: string,
    asOf: string,
    underlying = "PETR4",
  ): OptionSeries => ({
    ticker,
    underlying,
    right: "call",
    strike: decimalString("10.00"),
    expiry,
    style: "european",
    asOf,
  });

  const price = (ticker: string, session: string, trades: number): OptionDayPrice => ({
    ticker,
    session,
    asOf: `${session}T21:00:00.000Z`,
    average: null,
    close: decimalString("1.00"),
    trades,
    tradedQuantity: trades > 0 ? 100 : 0,
  });

  const calendar = calendarSessions(10);
  const session = sessionAt(9);
  const at = calendar[9]?.close ?? "";
  const candles = [dailyCandle("PETR4", 9, "40.00")];

  it("excludes a series published after at and one already expired by the reading session", () => {
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles,
      optionSeries: [
        callSeries("PETRA10", sessionAt(30), `${session}T13:00:00.000Z`),
        callSeries("PETRA20", sessionAt(30), `${session}T23:00:00.000Z`),
        callSeries("PETRA30", sessionAt(5), `${session}T13:00:00.000Z`),
      ],
    };
    const result = computeAssetReading(view, "PETR4", at, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options.nextExpiries).toEqual([
      { expiry: sessionAt(30), series: 1, tradedSeries: 0 },
    ]);
  });

  it("collapses strike-epoch duplicates to one distinct ticker", () => {
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles,
      optionSeries: [
        callSeries("PETRA10", sessionAt(30), `${session}T13:00:00.000Z`),
        callSeries("PETRA10", sessionAt(30), `${session}T14:00:00.000Z`),
      ],
      optionPrices: [price("PETRA10", session, 5)],
    };
    const result = computeAssetReading(view, "PETR4", at, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options.tradedSeries).toBe(1);
    expect(result.value.options.nextExpiries).toEqual([
      { expiry: sessionAt(30), series: 1, tradedSeries: 1 },
    ]);
  });

  it("counts a traded series only when its own day price shows trades, and labels liquidity from the count", () => {
    const tenTradedTickers = Array.from({ length: 10 }, (_, i) => `PETRA${String(i)}`);
    const optionSeries = [
      ...tenTradedTickers.map((ticker) =>
        callSeries(ticker, sessionAt(30), `${session}T13:00:00.000Z`),
      ),
      callSeries("PETRA_UNTRADED", sessionAt(30), `${session}T13:00:00.000Z`),
    ];
    const optionPrices = [
      ...tenTradedTickers.map((ticker) => price(ticker, session, 3)),
      price("PETRA_UNTRADED", session, 0),
    ];
    const view: MarketView = { ...emptyView, calendar, candles, optionSeries, optionPrices };
    const result = computeAssetReading(view, "PETR4", at, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options.tradedSeries).toBe(10);
    expect(result.value.options.label).toBe("liquid");
  });

  it("caps nextExpiries at the first three distinct expiries, ascending", () => {
    const optionSeries = [
      callSeries("PETRA10", sessionAt(10), `${session}T13:00:00.000Z`),
      callSeries("PETRA20", sessionAt(20), `${session}T13:00:00.000Z`),
      callSeries("PETRA30", sessionAt(30), `${session}T13:00:00.000Z`),
      callSeries("PETRA40", sessionAt(40), `${session}T13:00:00.000Z`),
    ];
    const view: MarketView = { ...emptyView, calendar, candles, optionSeries };
    const result = computeAssetReading(view, "PETR4", at, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options.nextExpiries.map((e) => e.expiry)).toEqual([
      sessionAt(10),
      sessionAt(20),
      sessionAt(30),
    ]);
  });
});

describe("computeAssetReading — invalid view (#304)", () => {
  it("propagates a duplicate calendar date as invalid_input, the pattern every other method follows", () => {
    const calendar = [
      { date: "2024-01-01", open: "2024-01-01T13:00:00.000Z", close: "2024-01-01T21:00:00.000Z" },
      { date: "2024-01-01", open: "2024-01-01T13:00:00.000Z", close: "2024-01-01T21:00:00.000Z" },
    ];
    const view: MarketView = { ...emptyView, calendar };
    const result = computeAssetReading(view, "PETR4", "2024-01-01T21:00:00.000Z", provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("propagates a non-positive candle price as invalid_input", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [dailyCandle("PETR4", 0, "0.00")],
    };
    const result = computeAssetReading(view, "PETR4", "2024-01-01T21:00:00.000Z", provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("propagates a duplicate implied-volatility index point as invalid_input", () => {
    const point: ImpliedVolatilityIndexPoint = {
      underlying: "PETR4",
      session: "2024-01-01",
      asOf: "2024-01-01T21:00:00.000Z",
      impliedVolatility: decimalString("0.3"),
    };
    const view: MarketView = {
      ...emptyView,
      impliedVolatilityIndex: [point, { ...point, impliedVolatility: decimalString("0.31") }],
    };
    const result = computeAssetReading(view, "PETR4", "2024-01-01T21:00:00.000Z", provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });
});

describe("computeAssetReading — reading session fallback (#304)", () => {
  it("nulls the options session when at falls before every calendar session, with no candle either", () => {
    const calendar = calendarSessions(3);
    const view: MarketView = { ...emptyView, calendar };
    const before = "2023-12-31T00:00:00.000Z";
    const result = computeAssetReading(view, "PETR4", before, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options).toEqual({
      label: "none",
      session: null,
      tradedSeries: 0,
      nextExpiries: [],
    });
  });
});
