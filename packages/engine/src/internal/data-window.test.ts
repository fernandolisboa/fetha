import { describe, expect, it } from "vitest";
import type { Condition, LegTemplate, StrategyDefinition, Structure } from "@fetha/contracts";
import type { DataWindowInput, StrategyVersion, TradingSession } from "../api";
import { dataWindow } from "./data-window";
import { decimalString } from "./test-support";

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

describe("dataWindow", () => {
  it("derives a daily lookback from an SMA length, from = close of the session length-1 sessions back", () => {
    const calendar = dailySessions(30);
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(20, "sma"), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at: "2024-01-30T20:00:00.000Z",
    };
    const result = dataWindow(input);
    expect(result.to).toBe(input.at);
    expect(result.timeframes).toEqual(["D1"]);
    expect(result.instruments).toEqual(["PETR4"]);
    // 20 sessions back from 2024-01-30 (inclusive) starts at 2024-01-11
    expect(result.from).toBe("2024-01-11T20:00:00.000Z");
    expect(result.collections).toContain("candles");
    expect(result.collections).toContain("corporateActions");
    expect(result.collections).not.toContain("optionSeries");
    expect(result.collections).not.toContain("impliedVolatilityIndex");
  });

  it("needs length + 1 candles for RSI and ATR", () => {
    const calendar = dailySessions(30);
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(5, "rsi"), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at: "2024-01-30T20:00:00.000Z",
    };
    // needs 6 candles -> from the session 5 sessions back: 2024-01-25
    expect(dataWindow(input).from).toBe("2024-01-25T20:00:00.000Z");
  });

  it("converts intraday candle counts to sessions using the session's open/close window", () => {
    const calendar = dailySessions(10);
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(40, "rsi"), timeframe: "15m", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at: "2024-01-10T20:00:00.000Z",
    };
    // 7h session = 28 candles of 15m; needs 41 candles -> ceil(41/28) = 2 sessions back -> session 9
    const result = dataWindow(input);
    expect(result.timeframes).toEqual(["15m"]);
    expect(result.from).toBe("2024-01-09T20:00:00.000Z");
  });

  it("reaches back lookbackSessions for iv_rank and requests the implied-volatility index", () => {
    const calendar = dailySessions(40);
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: ivRankCondition(30), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at: "2024-02-09T20:00:00.000Z",
    };
    const result = dataWindow(input);
    expect(result.collections).toContain("impliedVolatilityIndex");
    expect(result.from).toBe("2024-01-11T20:00:00.000Z");
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

  it("stops at the last session at or before at when the calendar extends into the future", () => {
    const calendar = dailySessions(35);
    const input: DataWindowInput = {
      strategy: strategy(
        definition({ entry: compareCondition(5, "sma"), timeframe: "D1", structureId: "stock" }),
        stockStructure,
      ),
      instruments: ["PETR4"],
      calendar,
      at: "2024-01-30T20:00:00.000Z",
    };
    expect(dataWindow(input).from).toBe("2024-01-26T20:00:00.000Z");
  });

  it("collects indicator specs nested under and/or/not conditions", () => {
    const calendar = dailySessions(30);
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
      at: "2024-01-30T20:00:00.000Z",
    };
    expect(dataWindow(input).from).toBe("2024-01-06T20:00:00.000Z");
  });

  it("also collects an indicator spec on the right side of a compare condition", () => {
    const calendar = dailySessions(30);
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
      at: "2024-01-30T20:00:00.000Z",
    };
    expect(dataWindow(input).from).toBe("2024-01-16T20:00:00.000Z");
  });

  it("also collects indicator specs referenced from a roll adjustment rule's condition, ignoring non-condition rules", () => {
    const calendar = dailySessions(30);
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
      at: "2024-01-30T20:00:00.000Z",
    };
    expect(dataWindow(input).from).toBe("2024-01-11T20:00:00.000Z");
  });

  it("also collects indicator specs referenced from a condition exit rule, ignoring non-condition rules", () => {
    const calendar = dailySessions(30);
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
      at: "2024-01-30T20:00:00.000Z",
    };
    expect(dataWindow(input).from).toBe("2024-01-06T20:00:00.000Z");
  });
});
