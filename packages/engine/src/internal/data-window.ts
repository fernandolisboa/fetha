import type {
  Condition,
  IndicatorSpec,
  Instant,
  StrategyDefinition,
  Timeframe,
} from "@fetha/contracts";
import type { DataWindow, DataWindowInput, MarketViewCollection, TradingSession } from "../api";
import { instantMs, isAtOrBefore } from "./instant";
import { assertDefined } from "./invariant";

const timeframeMinutes: Record<Timeframe, number | null> = {
  "15m": 15,
  "30m": 30,
  "60m": 60,
  D1: null,
};

const RECURSIVE_WARMUP_MULTIPLIER = 3;

export function dataWindow(input: DataWindowInput): DataWindow {
  const { strategy, instruments, calendar, at, since } = input;
  const sortedCalendar = [...calendar].sort((a, b) => a.date.localeCompare(b.date));

  const indicators = collectIndicatorSpecs(strategy.definition);
  const candlesNeeded = Math.max(1, ...indicators.map(candleCountFor));
  const ivSessionsNeeded = Math.max(
    0,
    ...indicators.filter((i) => i.kind === "iv_rank").map((i) => i.lookbackSessions),
  );

  const anchor = since ?? at;
  const anchorIndex = findSessionIndexAtOrBefore(sortedCalendar, anchor);

  const from =
    anchorIndex === null
      ? at
      : computeFrom(
          sortedCalendar,
          anchorIndex,
          candlesNeeded,
          ivSessionsNeeded,
          strategy.definition.timeframe,
          anchor,
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

function findSessionIndexAtOrBefore(
  calendar: readonly TradingSession[],
  instant: Instant,
): number | null {
  let index: number | null = null;
  for (let i = 0; i < calendar.length; i += 1) {
    const session = assertDefined(calendar[i], "dataWindow: missing calendar session");
    if (isAtOrBefore(session.open, instant)) index = i;
    else break;
  }
  return index;
}

function candlesPerSession(session: TradingSession, minutes: number | null): number {
  if (minutes === null) return 1;
  return Math.max(
    1,
    Math.floor((instantMs(session.close) - instantMs(session.open)) / (minutes * 60_000)),
  );
}

function computeFrom(
  calendar: readonly TradingSession[],
  anchorIndex: number,
  candlesNeeded: number,
  ivSessionsNeeded: number,
  timeframe: Timeframe,
  anchor: Instant,
): Instant {
  const minutes = timeframeMinutes[timeframe];
  const anchorSession = assertDefined(calendar[anchorIndex], "dataWindow: missing anchor session");

  const closedInAnchorSession =
    minutes === null
      ? isAtOrBefore(anchorSession.close, anchor)
        ? 1
        : 0
      : Math.max(
          0,
          Math.floor((instantMs(anchor) - instantMs(anchorSession.open)) / (minutes * 60_000)),
        );

  let remaining = candlesNeeded - closedInAnchorSession;
  let sessionsBack = 0;
  while (remaining > 0 && anchorIndex - sessionsBack > 0) {
    sessionsBack += 1;
    const session = assertDefined(
      calendar[anchorIndex - sessionsBack],
      "dataWindow: missing prior session",
    );
    remaining -= candlesPerSession(session, minutes);
  }

  const candleEarliestIndex = Math.max(0, anchorIndex - sessionsBack);
  const ivEarliestIndex =
    ivSessionsNeeded > 0 ? Math.max(0, anchorIndex - (ivSessionsNeeded - 1)) : anchorIndex;
  const earliestIndex = Math.min(candleEarliestIndex, ivEarliestIndex);

  const boundarySession = assertDefined(
    calendar[earliestIndex],
    "dataWindow: missing earliest needed session",
  );
  return earliestIndex > 0
    ? assertDefined(
        calendar[earliestIndex - 1],
        "dataWindow: missing session preceding the earliest needed session",
      ).close
    : boundarySession.open;
}

function candleCountFor(indicator: IndicatorSpec): number {
  switch (indicator.kind) {
    case "sma":
      return indicator.length;
    case "ema":
    case "rsi":
    case "atr":
      return indicator.length * RECURSIVE_WARMUP_MULTIPLIER;
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
