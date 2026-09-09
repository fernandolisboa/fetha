import { describe, expect, it } from "vitest";
import type {
  Condition,
  Instant,
  LegTemplate,
  StrategyDefinition,
  Structure,
} from "@fetha/contracts";
import type {
  Candle,
  DataWindowInput,
  ImpliedVolatilityIndexPoint,
  IndicatorsInput,
  StrategyVersion,
  TradingSession,
} from "../api";
import { dataWindow } from "./data-window";
import { computeIndicators } from "./indicators-computation";
import { compareInstants, isAfter, isAtOrBefore } from "./instant";
import { decimalString } from "../test/support";

const emptyIndicatorsView: IndicatorsInput["view"] = {
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

const dailySessions = (count: number): TradingSession[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i));
    const date = d.toISOString().slice(0, 10);
    return { date, open: `${date}T13:00:00.000Z`, close: `${date}T20:00:00.000Z` };
  });

const compareCondition = (
  indicatorLength: number,
  kind: "sma" | "rsi" | "atr" | "ema",
): Condition => ({
  kind: "compare",
  left: { kind: "indicator", indicator: { kind, length: indicatorLength } },
  comparator: ">",
  right: { kind: "constant", value: decimalString("0") },
});

const ivRankCondition = (lookbackSessions: number): Condition => ({
  kind: "compare",
  left: { kind: "indicator", indicator: { kind: "iv_rank", lookbackSessions } },
  comparator: ">",
  right: { kind: "constant", value: decimalString("50") },
});

const stockStructure: Structure = {
  id: "stock",
  name: "Stock",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }],
};

const coveredCallStructure: Structure = {
  id: "covered_call",
  name: "Covered call",
  expiry: "shared",
  legs: [
    { role: "stock", side: "buy", ratio: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
  ] as LegTemplate[],
};

const definition = (
  overrides: Partial<StrategyDefinition> &
    Pick<StrategyDefinition, "entry" | "timeframe" | "structureId">,
): StrategyDefinition => ({
  name: "test",
  strikes: [],
  sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
  exit: [],
  adjustments: [],
  ...overrides,
});

const strategy = (def: StrategyDefinition, structure: Structure): StrategyVersion => ({
  id: "v1",
  definition: def,
  structure,
});

const closedDailyCandleCount = (
  calendar: readonly TradingSession[],
  from: Instant,
  at: Instant,
): number => calendar.filter((s) => isAfter(s.close, from) && isAtOrBefore(s.close, at)).length;

const intradayCandleAsOfs = (calendar: readonly TradingSession[], minutes: number): Instant[] => {
  const result: Instant[] = [];
  for (const session of calendar) {
    let cursor = new Date(session.open).getTime();
    const close = new Date(session.close).getTime();
    while (cursor + minutes * 60_000 <= close) {
      cursor += minutes * 60_000;
      result.push(new Date(cursor).toISOString());
    }
  }
  return result;
};

const intraday15mCandleAsOfs = (calendar: readonly TradingSession[]): Instant[] =>
  intradayCandleAsOfs(calendar, 15);

const weekdaySessions = (count: number): TradingSession[] => {
  const result: TradingSession[] = [];
  const cursor = new Date(Date.UTC(2024, 0, 1));
  while (result.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      const date = cursor.toISOString().slice(0, 10);
      result.push({ date, open: `${date}T13:00:00.000Z`, close: `${date}T20:00:00.000Z` });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
};

const countVisibleCandles = (asOfs: readonly Instant[], from: Instant, at: Instant): number =>
  asOfs.filter((asOf) => isAfter(asOf, from) && isAtOrBefore(asOf, at)).length;

describe("dataWindow", () => {
  it("derives a daily lookback so at least `length` D1 sessions closed within (from, at] are visible", () => {
    const calendar = dailySessions(30);
    const at: Instant = "2024-01-30T20:00:00.000Z";
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(20, "sma"), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    expect(result.to).toBe(at);
    expect(result.timeframes).toEqual(["D1"]);
    expect(result.instruments).toEqual(["PETR4"]);
    expect(closedDailyCandleCount(calendar, result.from, at)).toBeGreaterThanOrEqual(20);
    expect(result.collections).toContain("candles");
    expect(result.collections).toContain("corporateActions");
    expect(result.collections).not.toContain("optionSeries");
    expect(result.collections).not.toContain("impliedVolatilityIndex");
  });

  it("counts only closed D1 sessions when at falls mid-session: SMA(20) at 15:00 still yields >= 20 closes", () => {
    const calendar = dailySessions(30);
    const at: Instant = "2024-01-30T15:00:00.000Z";
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(20, "sma"), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    // Today's session (2024-01-30) has not closed at 15:00 (close is 20:00), so it
    // must not count toward the 20 closes: only sessions strictly before today can.
    const todaysSession = calendar[29];
    expect(todaysSession).toBeDefined();
    const closedBeforeToday = calendar
      .slice(0, 29)
      .filter((s) => isAfter(s.close, result.from)).length;
    expect(closedBeforeToday).toBeGreaterThanOrEqual(20);
    if (todaysSession) {
      expect(
        isAfter(todaysSession.close, result.from) && isAtOrBefore(todaysSession.close, at),
      ).toBe(false);
    }
  });

  it("requests a 3x-length warm-up for the recursive indicators (RSI, ATR, EMA), yielding well over length + 1 candles", () => {
    const calendar = dailySessions(30);
    const at: Instant = "2024-01-30T20:00:00.000Z";
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(5, "rsi"), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    // 3 * 5 = 15 sessions of warm-up, well above the naive length + 1 = 6.
    expect(closedDailyCandleCount(calendar, result.from, at)).toBeGreaterThanOrEqual(15);
  });

  it("converts intraday candle counts to a from anchored at a prior session close: RSI(40) on 15m yields >= 41 visible candles", () => {
    const calendar = dailySessions(20);
    const lastSession = calendar.at(-1);
    expect(lastSession).toBeDefined();
    const at = lastSession?.close as Instant;
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(40, "rsi"), timeframe: "15m", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    expect(result.timeframes).toEqual(["15m"]);
    const asOfs = intraday15mCandleAsOfs(calendar);
    expect(countVisibleCandles(asOfs, result.from, at)).toBeGreaterThanOrEqual(41);
    // The from anchor is a session boundary, so every candle of the earliest needed
    // session (the one right after the boundary session) is strictly after it.
    const boundarySessionIndex = calendar.findIndex(
      (s) => compareInstants(s.close, result.from) === 0,
    );
    const earliestNeededSession = calendar[boundarySessionIndex + 1];
    if (boundarySessionIndex >= 0 && earliestNeededSession) {
      const firstCandleOfSession = new Date(
        new Date(earliestNeededSession.open).getTime() + 15 * 60_000,
      ).toISOString();
      expect(isAfter(firstCandleOfSession, result.from)).toBe(true);
    }
  });

  it("clamps candles already closed in the anchor session to that session's own count when at is two hours after the close: EMA(20) 15m needs 60", () => {
    const calendar = dailySessions(20);
    const lastSession = calendar.at(-1);
    expect(lastSession).toBeDefined();
    const at = new Date(
      new Date(lastSession?.close as Instant).getTime() + 2 * 60 * 60_000,
    ).toISOString();
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(20, "ema"), timeframe: "15m", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    const asOfs = intraday15mCandleAsOfs(calendar);
    expect(countVisibleCandles(asOfs, result.from, at)).toBeGreaterThanOrEqual(60);
  });

  it("clamps the anchor session's closed-candle count when at is a next-morning pre-open, hours after the prior close: SMA(45) 15m needs 45", () => {
    const calendar = dailySessions(5);
    const lastSession = calendar.at(-1);
    expect(lastSession).toBeDefined();
    const at = new Date(
      new Date(lastSession?.close as Instant).getTime() + 12 * 60 * 60_000,
    ).toISOString();
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(45, "sma"), timeframe: "15m", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    const asOfs = intraday15mCandleAsOfs(calendar);
    expect(countVisibleCandles(asOfs, result.from, at)).toBeGreaterThanOrEqual(45);
  });

  it("reaches back across a weekend gap for a Monday pre-open anchor: SMA(40) 15m", () => {
    const calendar = weekdaySessions(15);
    const monday = calendar[5];
    expect(monday).toBeDefined();
    const at = new Date(
      new Date(monday?.open as Instant).getTime() - 5 * 60 * 60_000,
    ).toISOString();
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(40, "sma"), timeframe: "15m", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    const asOfs = intradayCandleAsOfs(calendar, 15);
    expect(countVisibleCandles(asOfs, result.from, at)).toBeGreaterThanOrEqual(40);
  });

  it("anchors a 60m lookback at midnight UTC via since: SMA(15) 60m", () => {
    const calendar = dailySessions(20);
    const since = calendar[10]?.open as Instant;
    const midnightSince = since.slice(0, 10) + "T00:00:00.000Z";
    const at: Instant = "2024-01-20T20:00:00.000Z";
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(15, "sma"), timeframe: "60m", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
      since: midnightSince,
    };
    const result = dataWindow(input);
    const asOfs = intradayCandleAsOfs(calendar, 60);
    expect(countVisibleCandles(asOfs, result.from, midnightSince)).toBeGreaterThanOrEqual(15);
  });

  it("clamps the closed-candle count to a half-day anchor session's own smaller count when at is after that early close", () => {
    const calendar = dailySessions(10);
    const earlyCloseIndex = 6;
    const earlySession = calendar[earlyCloseIndex];
    expect(earlySession).toBeDefined();
    if (earlySession) {
      calendar[earlyCloseIndex] = { ...earlySession, close: `${earlySession.date}T16:00:00.000Z` };
    }
    const halfDay = calendar[earlyCloseIndex];
    expect(halfDay).toBeDefined();
    const at = new Date(new Date(halfDay?.close as Instant).getTime() + 60 * 60_000).toISOString();
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(15, "sma"), timeframe: "15m", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    const asOfs = intradayCandleAsOfs(calendar, 15);
    expect(countVisibleCandles(asOfs, result.from, at)).toBeGreaterThanOrEqual(15);
  });

  it("reaches back lookbackSessions for iv_rank and requests the implied-volatility index", () => {
    const calendar = dailySessions(40);
    const at: Instant = "2024-02-09T20:00:00.000Z";
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: ivRankCondition(30), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    expect(result.collections).toContain("impliedVolatilityIndex");
    const sessionsInWindow = calendar.filter(
      (s) => isAfter(s.close, result.from) && isAtOrBefore(s.close, at),
    ).length;
    expect(sessionsInWindow).toBeGreaterThanOrEqual(30);
  });

  it("reaches back one further session for iv_rank when the anchor session has not closed yet (D1, mid-session at), so the window still yields a non-null iv_rank on the freshest candle", () => {
    const calendar = dailySessions(40);
    const anchorSession = calendar[29];
    if (!anchorSession) throw new Error("missing anchor session fixture");
    const at = `${anchorSession.date}T15:00:00.000Z`;
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: ivRankCondition(5), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    const closedSessions = calendar.filter((s) => isAtOrBefore(s.close, at));
    const windowSessions = closedSessions.slice(-5);
    expect(windowSessions).toHaveLength(5);
    for (const s of windowSessions) {
      expect(isAfter(s.close, result.from)).toBe(true);
      expect(isAtOrBefore(s.close, result.to)).toBe(true);
    }

    const candles: Candle[] = windowSessions.map((s) => ({
      ticker: "PETR4",
      timeframe: "D1",
      session: s.date,
      asOf: s.close,
      open: decimalString("10.00"),
      high: decimalString("10.00"),
      low: decimalString("10.00"),
      close: decimalString("10.00"),
      tradedQuantity: 1000,
    }));
    const points: ImpliedVolatilityIndexPoint[] = windowSessions.map((s, i) => ({
      underlying: "PETR4",
      session: s.date,
      asOf: s.close,
      impliedVolatility: decimalString((0.1 + i * 0.05).toFixed(2)),
    }));
    const indicatorsResult = computeIndicators({
      view: { ...emptyIndicatorsView, candles, impliedVolatilityIndex: points },
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "iv_rank", lookbackSessions: 5 }],
      at,
    });
    expect(indicatorsResult.ok).toBe(true);
    if (!indicatorsResult.ok) return;
    const series = indicatorsResult.value.series[0];
    expect(series?.values.at(-1)).not.toBeNull();
  });

  it("reaches back one further session for iv_rank when the anchor session has not closed yet (15m, mid-session at), so the window still yields a non-null iv_rank on the freshest candle", () => {
    const calendar = dailySessions(40);
    const anchorSession = calendar[29];
    if (!anchorSession) throw new Error("missing anchor session fixture");
    const at = `${anchorSession.date}T15:07:00.000Z`;
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: ivRankCondition(5), timeframe: "15m", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    const closedSessions = calendar.filter((s) => isAtOrBefore(s.close, at));
    const windowSessions = closedSessions.slice(-5);
    expect(windowSessions).toHaveLength(5);
    for (const s of windowSessions) {
      expect(isAfter(s.close, result.from)).toBe(true);
      expect(isAtOrBefore(s.close, result.to)).toBe(true);
    }

    const freshestCandleAsOf = `${anchorSession.date}T15:00:00.000Z`;
    const candles: Candle[] = [
      {
        ticker: "PETR4",
        timeframe: "15m",
        session: anchorSession.date,
        asOf: freshestCandleAsOf,
        open: decimalString("10.00"),
        high: decimalString("10.00"),
        low: decimalString("10.00"),
        close: decimalString("10.00"),
        tradedQuantity: 1000,
      },
    ];
    const points: ImpliedVolatilityIndexPoint[] = windowSessions.map((s, i) => ({
      underlying: "PETR4",
      session: s.date,
      asOf: s.close,
      impliedVolatility: decimalString((0.1 + i * 0.05).toFixed(2)),
    }));
    const indicatorsResult = computeIndicators({
      view: { ...emptyIndicatorsView, candles, impliedVolatilityIndex: points },
      ticker: "PETR4",
      timeframe: "15m",
      indicators: [{ kind: "iv_rank", lookbackSessions: 5 }],
      at,
    });
    expect(indicatorsResult.ok).toBe(true);
    if (!indicatorsResult.ok) return;
    const series = indicatorsResult.value.series[0];
    expect(series?.values.at(-1)).not.toBeNull();
  });

  it("anchors the lookback at the last session <= since, not at at, when since is present", () => {
    const calendar = dailySessions(30);
    const since: Instant = "2024-01-10T20:00:00.000Z";
    const at: Instant = "2024-01-30T20:00:00.000Z";
    const def = definition({
      entry: compareCondition(5, "sma"),
      timeframe: "D1",
      structureId: "stock",
    });
    const withSince = dataWindow({
      strategy: strategy(def, stockStructure),
      instruments: ["PETR4"],
      calendar,
      at,
      since,
    });
    const anchoredAtSince = dataWindow({
      strategy: strategy(def, stockStructure),
      instruments: ["PETR4"],
      calendar,
      at: since,
    });
    expect(withSince.from).toBe(anchoredAtSince.from);
    expect(withSince.to).toBe(at);
  });

  it("requests the option chain and rates when the structure has option legs", () => {
    const calendar = dailySessions(30);
    const input: DataWindowInput = {
      strategy: strategy(
        definition({
          entry: compareCondition(5, "sma"),
          timeframe: "D1",
          structureId: "covered_call",
        }),
        coveredCallStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at: "2024-01-30T20:00:00.000Z",
    };
    const result = dataWindow(input);
    expect(result.collections).toContain("optionSeries");
    expect(result.collections).toContain("optionPrices");
    expect(result.collections).toContain("macro");
    expect(result.collections).toContain("dividendYields");
  });

  it("falls back to at when the calendar has no session at or before at", () => {
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(5, "sma"), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar: [],
      at: "2024-01-30T20:00:00.000Z",
    };
    expect(dataWindow(input).from).toBe(input.at);
  });

  it("falls back to the calendar's first session open, not at, when since reaches back before the calendar starts", () => {
    const calendar = dailySessions(10);
    const firstSession = calendar[0];
    expect(firstSession).toBeDefined();
    const since = "2023-12-01T00:00:00.000Z";
    const at: Instant = "2024-01-10T20:00:00.000Z";
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(5, "sma"), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
      since,
    };
    const result = dataWindow(input);
    expect(result.from).toBe(firstSession?.open);
    expect(result.from).not.toBe(at);
    expect(result.from).not.toBe(since);
  });

  it("stops at the last session at or before at when the calendar extends into the future, clamped by calendar length", () => {
    const calendar = dailySessions(35);
    const at: Instant = "2024-01-30T20:00:00.000Z";
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(5, "sma"), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    expect(closedDailyCandleCount(calendar, result.from, at)).toBeGreaterThanOrEqual(5);
    // Sessions after at must never be reached.
    expect(calendar.every((s) => !isAfter(s.close, at) || !isAfter(result.from, s.open))).toBe(
      true,
    );
  });

  it("yields a shorter window (fewer sessions than needed) when the calendar is shorter than the lookback, per the Math.max(0, ...) clamp", () => {
    const calendar = dailySessions(3);
    const at: Instant = "2024-01-03T20:00:00.000Z";
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(20, "sma"), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    const result = dataWindow(input);
    expect(closedDailyCandleCount(calendar, result.from, at)).toBeLessThan(20);
    expect(closedDailyCandleCount(calendar, result.from, at)).toBeGreaterThan(0);
  });

  it("collects indicator specs nested under and/or/not conditions", () => {
    const calendar = dailySessions(30);
    const at: Instant = "2024-01-30T20:00:00.000Z";
    const entry: Condition = {
      kind: "and",
      conditions: [
        { kind: "not", condition: compareCondition(25, "sma") },
        { kind: "or", conditions: [compareCondition(3, "ema")] },
      ],
    };
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry, timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    expect(closedDailyCandleCount(calendar, dataWindow(input).from, at)).toBeGreaterThanOrEqual(25);
  });

  it("also collects an indicator spec on the right side of a compare condition", () => {
    const calendar = dailySessions(30);
    const at: Instant = "2024-01-30T20:00:00.000Z";
    const entry: Condition = {
      kind: "compare",
      left: { kind: "constant", value: decimalString("0") },
      comparator: "<",
      right: { kind: "indicator", indicator: { kind: "sma", length: 15 } },
    };
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry, timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    expect(closedDailyCandleCount(calendar, dataWindow(input).from, at)).toBeGreaterThanOrEqual(15);
  });

  it("also collects indicator specs referenced from a roll adjustment rule's condition, ignoring non-condition rules", () => {
    const calendar = dailySessions(30);
    const at: Instant = "2024-01-30T20:00:00.000Z";
    const input: DataWindowInput = {
      strategy: strategy(
        definition({
          entry: {
            kind: "compare",
            left: { kind: "price", field: "close" },
            comparator: ">",
            right: { kind: "constant", value: decimalString("0") },
          },
          timeframe: "D1",
          structureId: "stock",
          adjustments: [
            {
              kind: "roll",
              when: { kind: "profit_target", fractionOfPremium: decimalString("0.5") },
              expiry: { kind: "business_days", min: 1, max: 5 },
              strikes: [{ kind: "nearest", price: decimalString("1") }],
            },
            {
              kind: "roll",
              when: { kind: "condition", condition: compareCondition(20, "sma") },
              expiry: { kind: "business_days", min: 1, max: 5 },
              strikes: [{ kind: "nearest", price: decimalString("1") }],
            },
          ],
        }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    expect(closedDailyCandleCount(calendar, dataWindow(input).from, at)).toBeGreaterThanOrEqual(20);
  });

  it("also collects indicator specs referenced from a condition exit rule, ignoring non-condition rules", () => {
    const calendar = dailySessions(30);
    const at: Instant = "2024-01-30T20:00:00.000Z";
    const input: DataWindowInput = {
      strategy: strategy(
        definition({
          entry: {
            kind: "compare",
            left: { kind: "price", field: "close" },
            comparator: ">",
            right: { kind: "constant", value: decimalString("0") },
          },
          timeframe: "D1",
          structureId: "stock",
          exit: [
            { kind: "profit_target", fractionOfPremium: decimalString("0.5") },
            { kind: "condition", condition: compareCondition(25, "sma") },
          ],
        }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at,
    };
    expect(closedDailyCandleCount(calendar, dataWindow(input).from, at)).toBeGreaterThanOrEqual(25);
  });
});
