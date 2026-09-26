import type {
  Condition,
  ExitRule,
  IndicatorSpec,
  LegTemplate,
  Operand,
  StrategyDefinition,
  Structure,
} from "@fetha/contracts";
import type {
  BacktestConfig,
  Candle,
  CorporateActionFactor,
  ImpliedVolatilityIndexPoint,
  MarketView,
  MacroPoint,
  RunBacktestInput,
  TradingSession,
} from "../api";
import { centavos, decimalString } from "./support";

export type SyntheticBacktestOptions = {
  sessions: number;
  instruments: number;
  entry?: Condition;
  exit?: ExitRule[];
  corporateActions?: boolean;
  impliedVolatility?: "none" | "in_order" | "one_late_point";
};

const warmUpSessions = 60;

function businessDays(count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(2019, 0, 2));
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function indicator(spec: IndicatorSpec): Operand {
  return { kind: "indicator", indicator: spec };
}

export const smaCrossUp: Condition = {
  kind: "compare",
  left: indicator({ kind: "sma", length: 20 }),
  comparator: ">",
  right: indicator({ kind: "sma", length: 50 }),
};

export const smaCrossDown: Condition = {
  kind: "compare",
  left: indicator({ kind: "sma", length: 20 }),
  comparator: "<",
  right: indicator({ kind: "sma", length: 50 }),
};

const stockStructure: Structure = {
  id: "stock",
  name: "Stock",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }] as LegTemplate[],
};

function closeAt(date: string): string {
  return `${date}T20:00:00.000Z`;
}

// A deterministic daily universe (#58): `sessions` period sessions after a 60-session warm-up,
// `instruments` random-walk tickers with gaps, optional corporate actions (one visible from the
// start, one published mid-period for an earlier ex-date) and an optional IV index, which with
// "one_late_point" carries one point published after later sessions' points.
export function syntheticBacktestInput(options: SyntheticBacktestOptions): RunBacktestInput {
  const dates = businessDays(options.sessions + warmUpSessions);
  const calendar: TradingSession[] = dates.map((date) => ({
    date,
    open: `${date}T13:00:00.000Z`,
    close: closeAt(date),
  }));
  const tickers = Array.from(
    { length: options.instruments },
    (_, i) => `TCK${String(i).padStart(2, "0")}3`,
  );
  const random = lcg(58);
  const candles: Candle[] = [];
  const iv: ImpliedVolatilityIndexPoint[] = [];
  for (const [tickerIndex, ticker] of tickers.entries()) {
    let price = 20 + random() * 30;
    let vol = 0.3;
    for (const [dateIndex, date] of dates.entries()) {
      const open = price;
      price = Math.max(1, price * (1 + (random() - 0.5) * 0.06));
      const high = Math.max(open, price) * (1 + random() * 0.01);
      const low = Math.min(open, price) * (1 - random() * 0.01);
      vol = Math.min(0.9, Math.max(0.1, vol + (random() - 0.5) * 0.04));
      const gap = tickerIndex === 1 && dateIndex % 37 === 5;
      if (!gap) {
        candles.push({
          ticker,
          timeframe: "D1",
          session: date,
          asOf: closeAt(date),
          open: decimalString(open.toFixed(2)),
          high: decimalString(high.toFixed(2)),
          low: decimalString(low.toFixed(2)),
          close: decimalString(price.toFixed(2)),
          tradedQuantity: 1000 + Math.floor(random() * 10_000),
        });
      }
      if (options.impliedVolatility !== undefined && options.impliedVolatility !== "none") {
        const late =
          options.impliedVolatility === "one_late_point" &&
          tickerIndex === 0 &&
          dateIndex === warmUpSessions + 10;
        iv.push({
          underlying: ticker,
          session: date,
          asOf: closeAt(late ? (dates[dateIndex + 5] as string) : date),
          impliedVolatility: decimalString(vol.toFixed(4)),
        });
      }
    }
  }
  const corporateActions: CorporateActionFactor[] = [];
  if (options.corporateActions === true && tickers.length >= 3) {
    corporateActions.push(
      {
        ticker: tickers[0] as string,
        exDate: dates[20] as string,
        asOf: closeAt(dates[10] as string),
        factor: decimalString("0.5"),
      },
      {
        ticker: tickers[2] as string,
        exDate: dates[warmUpSessions + 20] as string,
        asOf: closeAt(dates[warmUpSessions + 40] as string),
        factor: decimalString("0.25"),
      },
    );
  }
  const macro: MacroPoint[] = [
    {
      series: "cdi",
      date: dates[0] as string,
      asOf: closeAt(dates[0] as string),
      annualRate: decimalString("0.1065"),
    },
  ];
  const view: MarketView = {
    calendar,
    candles,
    corporateActions,
    optionSeries: [],
    optionPrices: [],
    quotes: [],
    macro,
    dividendYields: [],
    impliedVolatilityIndex: iv,
  };
  const definition: StrategyDefinition = {
    name: "synthetic",
    timeframe: "D1",
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.05") },
    entry: options.entry ?? smaCrossUp,
    exit: options.exit ?? [{ kind: "condition", condition: smaCrossDown }],
    adjustments: [],
  };
  const config: BacktestConfig = {
    strategy: { id: "synthetic", definition, structure: stockStructure },
    universe: tickers,
    period: { from: dates[warmUpSessions] as string, to: dates.at(-1) as string },
    initialCapital: centavos(1_000_000_00),
    costModel: {
      b3FeeRate: decimalString("0.0003"),
      brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(0) },
      optionSlippageRate: decimalString("0"),
      incomeTaxRate: decimalString("0.15"),
      monthlyStockSalesExemption: centavos(20_000_00),
    },
    riskProfile: {
      declaredCapital: centavos(1_000_000_00),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: options.instruments,
        maxPremiumBought: decimalString("1"),
      },
    },
    limits: "warn",
    sizing: null,
    walkForward: null,
    seed: 1,
  };
  return { view, config };
}
