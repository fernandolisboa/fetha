import { Decimal } from "decimal.js";
import type {
  AdjustmentRule,
  AnalysisFact,
  AnalysisFacts,
  Centavos,
  CostModel,
  DecimalString,
  ExitRule,
  SessionDate,
  StrategyDefinition,
} from "@fetha/contracts";
import type {
  AssetReading,
  BacktestMetrics,
  Greeks,
  IndicatorReading,
  LegValuation,
  OperationLeg,
  OperationPricing,
  Proposal,
  SignalKind,
  WalkForwardWindow,
} from "@fetha/engine";

import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";
import { sessionDateToDisplayDate } from "@/modules/market-data";

const UNBOUNDED_LOSS = "ilimitada";
const UNBOUNDED_GAIN = "ilimitado";

function session(date: SessionDate): string {
  return formatDate(sessionDateToDisplayDate(date));
}

function money(centavos: Centavos): string {
  return formatBRL(centavos);
}

function moneyOrUnbounded(
  value: Centavos | "unbounded",
  unboundedWord: typeof UNBOUNDED_LOSS | typeof UNBOUNDED_GAIN,
): string {
  return value === "unbounded" ? unboundedWord : money(value);
}

function rate(fraction: DecimalString): string {
  return `${formatPercent(fraction)} a.a.`;
}

function greeksFacts(greeks: Greeks): AnalysisFacts {
  return {
    delta: formatDecimal(greeks.delta, 2),
    gamma: formatDecimal(greeks.gamma, 2),
    theta: formatDecimal(greeks.theta, 2),
    vega: formatDecimal(greeks.vega, 2),
    rho: formatDecimal(greeks.rho, 2),
  };
}

function legFacts(leg: LegValuation): AnalysisFacts {
  return {
    role: leg.leg.role,
    side: leg.leg.side,
    ticker: leg.leg.ticker,
    quantity: String(leg.leg.quantity),
    price: leg.price ? formatPriceBRL(leg.price) : null,
    priceSource: leg.priceSource,
    stale: leg.stale ? session(leg.stale.session) : null,
    fairValue: leg.fairValue ? formatPriceBRL(leg.fairValue) : null,
    impliedVolatility: leg.impliedVolatility ? formatPercent(leg.impliedVolatility) : null,
    greeks: leg.greeks ? greeksFacts(leg.greeks) : null,
  };
}

function uniqueCodes(notes: readonly { code: string }[]): string[] {
  return [...new Set(notes.map((note) => note.code))];
}

// `limitBreaches` carries only the breached limit's name, never `value`/
// `allowed` (docs/adr/0057): those derive from the user's declared capital,
// which must never reach the model.
export function pricingFacts(
  pricing: OperationPricing,
  maxPayoffPoints: number = MAX_PAYOFF_POINTS,
): AnalysisFacts {
  return {
    spot: formatPriceBRL(pricing.spot),
    riskFreeRate: rate(pricing.riskFreeRate),
    dividendYield: rate(pricing.dividendYield),
    netPremium: money(pricing.netPremium),
    maxLoss: moneyOrUnbounded(pricing.maxLoss, UNBOUNDED_LOSS),
    maxGain: moneyOrUnbounded(pricing.maxGain, UNBOUNDED_GAIN),
    breakEvens: pricing.breakEvens.map((price) => formatPriceBRL(price)),
    greeks: greeksFacts(pricing.greeks),
    legs: pricing.legs.map((leg) => legFacts(leg)),
    payoff: samplePayoff(pricing.payoff, maxPayoffPoints).map((point) => ({
      underlying: formatPriceBRL(point.underlying),
      pnl: money(point.pnl),
    })),
    limitBreaches: pricing.limitBreaches.map((breach) => breach.limit),
    notes: uniqueCodes(pricing.notes),
  };
}

const MAX_PAYOFF_POINTS = 21;
// A research sends up to twenty ideas in one request (docs/adr/0076), so each carries fewer points.
export const MAX_RESEARCH_PAYOFF_POINTS = 9;

// Evenly sampled, first and last kept, at most `maxPoints` points
// (docs/adr/0057): a payoff with more points than that is thinned by index,
// not by value, so the sampled curve still spans the same range.
export function samplePayoff<T>(points: readonly T[], maxPoints: number = MAX_PAYOFF_POINTS): T[] {
  if (points.length <= maxPoints) {
    return [...points];
  }
  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round(index * step);
    return points[Math.min(sourceIndex, points.length - 1)] as T;
  });
}

export function indicatorReadingFacts(readings: readonly IndicatorReading[]): AnalysisFact[] {
  return readings.map((reading) => ({
    indicator: genericFact(reading.indicator),
    value: reading.value ? formatDecimal(reading.value, 2) : null,
  }));
}

export interface SignalFactsInput {
  session: SessionDate;
  kind: SignalKind;
  ticker: string;
  timeframe: string;
  indicators: readonly IndicatorReading[];
  rule: ExitRule | AdjustmentRule | null;
  proposal: Proposal | null;
}

export function signalFacts(input: SignalFactsInput): AnalysisFacts {
  return {
    session: session(input.session),
    kind: input.kind,
    ticker: input.ticker,
    timeframe: input.timeframe,
    indicators: indicatorReadingFacts(input.indicators),
    rule: input.rule ? genericFact(input.rule) : null,
    proposal: input.proposal ? { pricing: pricingFacts(input.proposal.pricing) } : null,
  };
}

export interface ContemplatedOperationFactsInput {
  session: SessionDate;
  structure: string;
  underlying: string;
  pricing: OperationPricing;
}

export function contemplatedOperationFacts(input: ContemplatedOperationFactsInput): AnalysisFacts {
  return {
    session: session(input.session),
    structure: input.structure,
    underlying: input.underlying,
    pricing: pricingFacts(input.pricing),
  };
}

function readingFacts(reading: AssetReading): AnalysisFacts {
  return {
    trend: reading.trend.label,
    momentum: reading.momentum.label,
    range: reading.range.label,
    impliedVolatility: reading.impliedVolatility.label,
    options: reading.options.label,
  };
}

export interface SuggestionFactsInput {
  session: SessionDate;
  expiry: SessionDate;
  underlying: string;
  structure: string;
  recipe: { expectedMove: string; ivRegime: string; entry: unknown; exit: unknown };
  reading: AssetReading | null;
  close: DecimalString;
  indicators: readonly IndicatorReading[];
  pricing: OperationPricing;
}

// docs/adr/0067: the suggestion as the cards show it, the recipe's rule in the generic form a
// strategy definition takes elsewhere, and the asset reading by its labels only (the engine's
// raw readings are the entry indicators beside it).
export function suggestionFacts(input: SuggestionFactsInput): AnalysisFacts {
  return {
    session: session(input.session),
    expiry: session(input.expiry),
    underlying: input.underlying,
    structure: input.structure,
    recipe: {
      expectedMove: input.recipe.expectedMove,
      ivRegime: input.recipe.ivRegime,
      entry: genericFact(input.recipe.entry),
      exit: genericFact(input.recipe.exit),
    },
    reading: input.reading ? readingFacts(input.reading) : null,
    entry: {
      close: formatPriceBRL(input.close),
      indicators: indicatorReadingFacts(input.indicators),
    },
    pricing: pricingFacts(input.pricing),
  };
}

export interface ResearchIdeaFactsInput {
  underlying: string;
  structure: string;
  foundOn: SessionDate;
  ruleHolds: boolean;
  expiry: SessionDate;
  sessionsToExpiry: number;
  recipe: { expectedMove: string; ivRegime: string; entry: unknown; exit: unknown };
  reading: AssetReading;
  // Codes only: `rule_no_longer_holds`, `near_expiry` and the names of the breached limits.
  engineAlerts: readonly string[];
  pricing: OperationPricing;
  // The shared calibration of the idea's recipe (docs/adr/0067 item 9): the average result of one
  // lot over the scored suggestions, which does not grow with their number; null with none scored.
  trackRecord: {
    claimed: number;
    held: number;
    scored: number;
    averagePnl: Centavos;
  } | null;
  // The underlying's labelled CVM filings of the last 90 days, newest first, at most five.
  filings: readonly { deliveredOn: SessionDate; topic: string; tone: string; summary: string }[];
  newsTone: { tone: DecimalString; articles: number; windowDays: number } | null;
  providerNews: readonly { publishedOn: SessionDate; title: string; sentiment: DecimalString }[];
}

export interface ResearchFactsInput {
  newestClose: SessionDate;
  ideas: readonly ResearchIdeaFactsInput[];
}

// Every leaf of the facts is at most this long (`analysisFactSchema`); text from outside (a filing
// summary, a news title) is cut to fit instead of failing the whole request.
const MAX_FACT_TEXT = 200;

function clipped(text: string): string {
  return text.length <= MAX_FACT_TEXT ? text : `${text.slice(0, MAX_FACT_TEXT - 1).trimEnd()}…`;
}

function trackRecordFacts(
  record: NonNullable<ResearchIdeaFactsInput["trackRecord"]>,
): AnalysisFact {
  return {
    scored: String(record.scored),
    claimHeldShare:
      record.claimed === 0
        ? null
        : formatPercent(
            new Decimal(record.held).dividedBy(record.claimed).toFixed(4) as DecimalString,
          ),
    pnlPerLot: money(record.averagePnl),
  };
}

function researchIdeaFacts(idea: ResearchIdeaFactsInput): AnalysisFacts {
  return {
    underlying: idea.underlying,
    structure: idea.structure,
    foundOn: session(idea.foundOn),
    ruleHolds: idea.ruleHolds ? "yes" : "no",
    expiry: session(idea.expiry),
    sessionsToExpiry: `${String(idea.sessionsToExpiry)} sessões`,
    recipe: {
      expectedMove: idea.recipe.expectedMove,
      ivRegime: idea.recipe.ivRegime,
      entry: genericFact(idea.recipe.entry),
      exit: genericFact(idea.recipe.exit),
    },
    reading: readingFacts(idea.reading),
    tradedSeries: `${String(idea.reading.options.tradedSeries)} séries negociadas`,
    engineAlerts: [...idea.engineAlerts],
    pricing: pricingFacts(idea.pricing, MAX_RESEARCH_PAYOFF_POINTS),
    recipeTrackRecord: idea.trackRecord ? trackRecordFacts(idea.trackRecord) : null,
    filings:
      idea.filings.length === 0
        ? null
        : idea.filings.map((filing) => ({
            date: session(filing.deliveredOn),
            topic: filing.topic,
            tone: filing.tone,
            summary: clipped(filing.summary),
          })),
    newsTone: idea.newsTone
      ? {
          averageTone: formatDecimal(idea.newsTone.tone, 2),
          articles: String(idea.newsTone.articles),
          window: `${String(idea.newsTone.windowDays)} dias`,
        }
      : null,
    providerNews:
      idea.providerNews.length === 0
        ? null
        : idea.providerNews.map((article) => ({
            date: session(article.publishedOn),
            title: clipped(article.title),
            sentiment: formatDecimal(article.sentiment, 2),
          })),
  };
}

// docs/adr/0076: the facts of a research, one entry per idea sent, in the order they are shown.
// Nothing here is the user's: no capital, no limit value (only the names of the limits an idea
// breaches), no id, no text the user wrote, no strategy name.
export function researchFacts(input: ResearchFactsInput): AnalysisFacts {
  return {
    newestClose: session(input.newestClose),
    ideas: input.ideas.map(researchIdeaFacts),
  };
}

export interface HeldOperationFactsInput {
  session: SessionDate;
  underlying: string;
  openedAt: SessionDate;
  expiry: SessionDate | null;
  legs: readonly OperationLeg[];
  pricing: OperationPricing;
}

export function heldOperationFacts(input: HeldOperationFactsInput): AnalysisFacts {
  return {
    session: session(input.session),
    underlying: input.underlying,
    openedAt: session(input.openedAt),
    expiry: input.expiry ? session(input.expiry) : null,
    legs: input.legs.map((leg) => ({
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      quantity: String(leg.quantity),
      entryPrice: formatPriceBRL(leg.entryPrice),
    })),
    pricing: pricingFacts(input.pricing),
  };
}

function metricsFacts(metrics: BacktestMetrics): AnalysisFacts {
  return {
    sessions: String(metrics.sessions),
    operations: String(metrics.operations),
    totalReturn: formatPercent(metrics.totalReturn),
    cagr: metrics.cagr ? formatPercent(metrics.cagr) : null,
    maxDrawdown: formatPercent(metrics.maxDrawdown),
    sharpe: metrics.sharpe ? formatDecimal(metrics.sharpe, 2) : null,
    winRate: metrics.winRate ? formatPercent(metrics.winRate) : null,
    profitFactor: metrics.profitFactor ? formatDecimal(metrics.profitFactor, 2) : null,
    exposure: formatPercent(metrics.exposure),
    fees: money(metrics.fees),
    taxes: money(metrics.taxes),
    slippage: money(metrics.slippage),
  };
}

function costModelFacts(costModel: CostModel): AnalysisFacts {
  return {
    b3FeeRate: formatPercent(costModel.b3FeeRate),
    b3OptionFeeRate: costModel.b3OptionFeeRate ? formatPercent(costModel.b3OptionFeeRate) : null,
    brokerage: {
      stockPerOrder: money(costModel.brokerage.stockPerOrder),
      optionPerOrder: money(costModel.brokerage.optionPerOrder),
    },
    optionSlippageRate: formatPercent(costModel.optionSlippageRate),
    incomeTaxRate: formatPercent(costModel.incomeTaxRate),
    monthlyStockSalesExemption: money(costModel.monthlyStockSalesExemption),
  };
}

const MAX_WALK_FORWARD_WINDOWS = 12;

// The most recent windows are the ones closest to the current regime, so a
// run with more than the cap keeps its tail, not its head, and the fact
// below says how many were left out (docs/adr/0057).
function walkForwardOmittedFact(totalWindows: number): string {
  const omitted = Math.max(0, totalWindows - MAX_WALK_FORWARD_WINDOWS);
  if (omitted === 0) return "nenhuma janela de walk-forward omitida";
  return omitted === 1
    ? "1 janela de walk-forward omitida"
    : `${String(omitted)} janelas de walk-forward omitidas`;
}

export interface BacktestRunFactsInput {
  period: { from: SessionDate; to: SessionDate };
  timeframe: string;
  universe: readonly string[];
  initialCapital: Centavos;
  costModel: CostModel;
  strategy: StrategyDefinition;
  metrics: BacktestMetrics;
  walkForward: readonly WalkForwardWindow[];
  counts: { operations: number; missedEntries: number; limitBreaches: number };
  notes: readonly string[];
}

export function backtestRunFacts(input: BacktestRunFactsInput): AnalysisFacts {
  const strategyWithoutName: Record<string, unknown> = { ...input.strategy };
  delete strategyWithoutName.name;
  return {
    period: { from: session(input.period.from), to: session(input.period.to) },
    timeframe: input.timeframe,
    universe: [...input.universe],
    initialCapital: money(input.initialCapital),
    costModel: costModelFacts(input.costModel),
    strategy: genericFact(strategyWithoutName),
    metrics: metricsFacts(input.metrics),
    walkForward: input.walkForward.slice(-MAX_WALK_FORWARD_WINDOWS).map((window) => ({
      from: session(window.from),
      to: session(window.to),
      metrics: metricsFacts(window.metrics),
    })),
    walkForwardOmitted: walkForwardOmittedFact(input.walkForward.length),
    counts: {
      operations: String(input.counts.operations),
      missedEntries: String(input.counts.missedEntries),
      limitBreaches: String(input.counts.limitBreaches),
    },
    notes: [...new Set(input.notes)],
  };
}

const DECIMAL_STRING = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function toPtBrDecimal(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  return `${negative ? "−" : ""}${unsigned.replace(".", ",")}`;
}

// The one generic converter the brief allows for rules, indicator specs and
// a strategy definition (docs/adr/0057): decimal strings become pt-BR comma
// decimals, numbers become plain strings, booleans become "sim"/"não", and
// an `undefined` value is dropped from its object rather than written as
// null. `sizing.fraction` is the only field this treats as a percentage
// (every other decimal string here, like `multipleOfMaxLoss` or a
// `moneyness` percent, is shown as the engine's own decimal, unconverted).
export function genericFact(value: unknown, key?: string): AnalysisFact {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (key === "fraction") return formatPercent(value as DecimalString);
    return DECIMAL_STRING.test(value) ? toPtBrDecimal(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => genericFact(item));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, entryValue]) => entryValue !== undefined,
    );
    return Object.fromEntries(
      entries.map(([entryKey, entryValue]) => [entryKey, genericFact(entryValue, entryKey)]),
    );
  }
  return null;
}
