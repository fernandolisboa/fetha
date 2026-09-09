import { describe, expect, it } from "vitest";
import { engine } from "./engine";
import type {
  DataWindowInput,
  Engine,
  IndicatorsInput,
  MarkToMarketInput,
  ProposeSettlementInput,
  RunBacktestInput,
  ScoreInput,
  StrategyVersion,
} from "./api";
import { decimalString } from "./internal/test-support";

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

describe("engine", () => {
  it("satisfies the Engine interface", () => {
    const _typeCheck: Engine = engine;
    expect(_typeCheck).toBe(engine);
  });

  it("implements capabilities, dataWindow and indicators", async () => {
    expect(engine.capabilities().indicators).toEqual(["sma", "ema", "rsi", "atr", "iv_rank"]);

    const strategy: StrategyVersion = {
      id: "v1",
      definition: {
        name: "test",
        timeframe: "D1",
        entry: {
          kind: "compare",
          left: { kind: "price", field: "close" },
          comparator: ">",
          right: { kind: "constant", value: decimalString("0") },
        },
        structureId: "stock",
        strikes: [],
        sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
        exit: [],
        adjustments: [],
      },
      structure: {
        id: "stock",
        name: "Stock",
        expiry: "shared",
        legs: [{ role: "stock", side: "buy", ratio: 1 }],
      },
    };
    const dwInput: DataWindowInput = {
      strategy,
      instruments: ["PETR4"],
      calendar: [],
      at: "2024-01-30T20:00:00.000Z",
    };
    expect(engine.dataWindow(dwInput).to).toBe(dwInput.at);

    const indicatorsResult = await engine.indicators({
      view: emptyView,
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "sma", length: 2 }],
      at: "2024-01-30T20:00:00.000Z",
    });
    expect(indicatorsResult.ok).toBe(true);
  });

  it.each([
    [
      "priceOperation",
      () => engine.priceOperation({ view: emptyView, at: "2024-01-01T00:00:00.000Z", legs: [] }),
    ],
    [
      "evaluateStrategy",
      () =>
        engine.evaluateStrategy({
          view: emptyView,
          strategy: {} as StrategyVersion,
          instruments: [],
          at: "2024-01-01T00:00:00.000Z",
        }),
    ],
    [
      "runBacktest",
      () => engine.runBacktest({ view: emptyView, config: {} } as unknown as RunBacktestInput),
    ],
    [
      "markToMarket",
      () =>
        engine.markToMarket({
          view: emptyView,
          at: "2024-01-01T00:00:00.000Z",
          positions: [],
          operations: [],
          cash: 0,
        } as unknown as MarkToMarketInput),
    ],
    [
      "proposeSettlement",
      () =>
        engine.proposeSettlement({
          view: emptyView,
          operation: {},
        } as unknown as ProposeSettlementInput),
    ],
    ["score", () => engine.score({ view: emptyView } as unknown as ScoreInput)],
    [
      "impliedVolatilityIndex",
      () =>
        engine.impliedVolatilityIndex({
          view: emptyView,
          underlying: "PETR4",
          at: "2024-01-01T00:00:00.000Z",
        }),
    ],
  ] as const)(
    "%s returns invalid_input 'not implemented' without throwing",
    async (_name, call) => {
      const result = await call();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({ code: "invalid_input", path: "", message: "not implemented" });
    },
  );
});
