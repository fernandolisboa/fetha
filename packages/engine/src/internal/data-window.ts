import type { Condition, IndicatorSpec, StrategyDefinition } from "@fetha/contracts";
import type { DataWindow, DataWindowInput, MarketViewCollection, TradingSession } from "../api";
import { assertDefined } from "./invariant";

const timeframeMinutes: Record<string, number | null> = {
  "15m": 15,
  "30m": 30,
  "60m": 60,
  D1: null,
};

export function dataWindow(input: DataWindowInput): DataWindow {
  const { strategy, instruments, calendar, at } = input;
  const sortedCalendar = [...calendar].sort((a, b) => a.date.localeCompare(b.date));
  const currentIndex = findCurrentSessionIndex(sortedCalendar, at);

  const indicators = collectIndicatorSpecs(strategy.definition);
  const candlesNeeded = Math.max(1, ...indicators.map(candleCountFor));
  const ivSessionsNeeded = Math.max(
    0,
    ...indicators.filter((i) => i.kind === "iv_rank").map((i) => i.lookbackSessions),
  );

  const from =
    currentIndex === null
      ? at
      : sessionClose(
          sortedCalendar,
          currentIndex,
          candlesNeeded,
          ivSessionsNeeded,
          strategy.definition.timeframe,
        );

  const hasOptionLegs = strategy.structure.legs.some((leg) => leg.role !== "stock");
  const collections: MarketViewCollection[] = ["candles", "corporateActions"];
  if (ivSessionsNeeded > 0) collections.push("impliedVolatilityIndex");
  if (hasOptionLegs) collections.push("optionSeries", "optionPrices", "macro", "dividendYields");

  return {
    from,
    to: at,
    instruments,
    timeframes: [strategy.definition.timeframe],
    collections,
  };
}

function findCurrentSessionIndex(calendar: readonly TradingSession[], at: string): number | null {
  let index: number | null = null;
  for (let i = 0; i < calendar.length; i += 1) {
    const session = assertDefined(calendar[i], "dataWindow: missing calendar session");
    if (session.open <= at) index = i;
    else break;
  }
  return index;
}

function sessionClose(
  calendar: readonly TradingSession[],
  currentIndex: number,
  candlesNeeded: number,
  ivSessionsNeeded: number,
  timeframe: string,
): string {
  const minutes = timeframeMinutes[timeframe] ?? null;
  const currentSession = assertDefined(
    calendar[currentIndex],
    "dataWindow: missing current session",
  );
  const candlesPerSession =
    minutes === null
      ? 1
      : Math.max(
          1,
          Math.floor(
            (new Date(currentSession.close).getTime() - new Date(currentSession.open).getTime()) /
              (minutes * 60_000),
          ),
        );
  const sessionsFromCandles =
    minutes === null ? candlesNeeded : Math.ceil(candlesNeeded / candlesPerSession);
  const sessionsNeeded = Math.max(sessionsFromCandles, ivSessionsNeeded, 1);
  const earliestIndex = Math.max(0, currentIndex - (sessionsNeeded - 1));
  return assertDefined(calendar[earliestIndex], "dataWindow: missing earliest session").close;
}

function candleCountFor(indicator: IndicatorSpec): number {
  switch (indicator.kind) {
    case "sma":
    case "ema":
      return indicator.length;
    case "rsi":
    case "atr":
      return indicator.length + 1;
    case "iv_rank":
      return 1;
  }
}

function collectIndicatorSpecs(definition: StrategyDefinition): IndicatorSpec[] {
  const specs: IndicatorSpec[] = [];
  const visitCondition = (condition: Condition): void => {
    if (condition.kind === "compare") {
      if (condition.left.kind === "indicator") specs.push(condition.left.indicator);
      if (condition.right.kind === "indicator") specs.push(condition.right.indicator);
      return;
    }
    if (condition.kind === "not") {
      visitCondition(condition.condition);
      return;
    }
    condition.conditions.forEach(visitCondition);
  };

  visitCondition(definition.entry);
  for (const rule of definition.exit) {
    if (rule.kind === "condition") visitCondition(rule.condition);
  }
  for (const rule of definition.adjustments) {
    if (rule.when.kind === "condition") visitCondition(rule.when.condition);
  }
  return specs;
}
