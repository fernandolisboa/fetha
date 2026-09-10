import Decimal from "decimal.js";
import type { DecimalString, ExitRule, Instant, SessionDate, Ticker } from "@fetha/contracts";
import {
  ENGINE_VERSION,
  type Candle,
  type CorporateActionFactor,
  type Evaluation,
  type EvaluationOutcome,
  type EvaluationRecord,
  type EvaluateStrategyInput,
  type IndicatorReading,
  type MarketView,
  type Operation,
  type OperationLeg,
  type Result,
  type Signal,
  type TradingSession,
} from "../api";
import { batchTruncationReport } from "./batch-truncation";
import { buildCandleSeries, isPositiveDecimal, priceFields } from "./candle-series";
import {
  collectIndicatorSpecs,
  collectSpecsFromCondition,
  dedupeIndicatorSpecs,
  indicatorSpecKey,
} from "./collect-indicator-specs";
import { evaluateCondition, type ConditionContext } from "./condition-evaluator";
import { CENTAVOS_PER_REAL, parseDecimal } from "./decimal";
import { computeIndicators } from "./indicators-computation";
import { compareInstants, isAfter, isAtOrBefore } from "./instant";
import { assertDefined, invariant } from "./invariant";
import { codeUnitCompare, sortUnique } from "./order";
import { toQuantity } from "./scalars";
import { sizeStockEntry, type StockSizingReason } from "./sizing";
import { splitFactorProduct } from "./split-factor";
import { priceStockLegs } from "./stock-pricing";

const sizingDetail: Record<StockSizingReason, string> = {
  no_declared_capital: "no declared capital to size against",
  unbounded_max_loss: "fixed_risk sizing is unsizeable against an unbounded max loss",
  zero_units: "sizing yields fewer than one unit",
};

function invalidInput(path: string, message: string): Result<Evaluation> {
  return { ok: false, error: { code: "invalid_input", path, message } };
}

function record(
  ticker: Ticker,
  at: Instant,
  session: SessionDate,
  outcome: EvaluationOutcome,
  detail: string | null,
): EvaluationRecord {
  return { ticker, at, session, outcome, detail };
}

// The session for a record at `at` is the last calendar session whose `open <= at`, the same
// rule dataWindow uses; when the view carries no calendar row for `at`, this falls back to
// slicing the instant's own date (ADR-0013 "Missing instrument").
function sessionForInstant(calendar: readonly TradingSession[], at: Instant): SessionDate {
  const sorted = [...calendar].sort((a, b) => codeUnitCompare(a.date, b.date));
  let found: SessionDate | null = null;
  for (const session of sorted) {
    if (isAtOrBefore(session.open, at)) found = session.date;
    else break;
  }
  return found ?? at.slice(0, 10);
}

function validateCoherence(input: EvaluateStrategyInput): Result<Evaluation> | null {
  const { definition, structure } = input.strategy;
  if (definition.structureId !== structure.id) {
    return invalidInput(
      "strategy.definition.structureId",
      "definition.structureId must match structure.id",
    );
  }
  const hasOptionLegs = structure.legs.some((leg) => leg.role !== "stock");
  if (!hasOptionLegs) {
    if (definition.strikes.length > 0) {
      return invalidInput(
        "strategy.definition.strikes",
        "a stock-only structure cannot select strikes",
      );
    }
    if (definition.expiry !== undefined) {
      return invalidInput(
        "strategy.definition.expiry",
        "a stock-only structure has no expiry to select",
      );
    }
    if (definition.exit.some((rule) => rule.kind === "days_before_expiry")) {
      return invalidInput(
        "strategy.definition.exit",
        "days_before_expiry is meaningless for a stock-only structure",
      );
    }
    if (definition.adjustments.length > 0) {
      return invalidInput(
        "strategy.definition.adjustments",
        "roll is meaningless for a stock-only structure",
      );
    }
    return null;
  }
  if (definition.expiry === undefined) {
    return invalidInput(
      "strategy.definition.expiry",
      "a structure with option legs requires an expiry selection",
    );
  }
  const distinctRanks = new Set(
    structure.legs.filter((leg) => leg.role !== "stock").map((leg) => leg.strikeRank),
  ).size;
  if (definition.strikes.length !== distinctRanks) {
    return invalidInput(
      "strategy.definition.strikes",
      "strikes.length must equal the number of distinct strike ranks",
    );
  }
  return null;
}

function validateOpenOperations(input: EvaluateStrategyInput): Result<Evaluation> | null {
  const instrumentSet = new Set(input.instruments);
  const openOperations = input.openOperations ?? [];
  for (const [index, op] of openOperations.entries()) {
    if (!instrumentSet.has(op.underlying)) {
      return invalidInput(
        `openOperations[${String(index)}].underlying`,
        "an open operation's underlying must be among the batch's instruments",
      );
    }
    if (op.legs.some((leg) => leg.role !== "stock")) {
      return invalidInput(
        `openOperations[${String(index)}].legs`,
        "evaluateStrategy only evaluates stock-only operations for now",
      );
    }
    if (op.expiry !== null) {
      return invalidInput(
        `openOperations[${String(index)}].expiry`,
        "a stock-only operation must not have an expiry",
      );
    }
    for (const [legIndex, leg] of op.legs.entries()) {
      if (leg.ticker !== op.underlying) {
        return invalidInput(
          `openOperations[${String(index)}].legs[${String(legIndex)}].ticker`,
          "a stock leg's ticker must match the operation's underlying",
        );
      }
    }
  }
  return null;
}

function validateBatchInvariants(input: EvaluateStrategyInput): Result<Evaluation> | null {
  const instrumentDupe = sortUnique(input.instruments, (t) => t, codeUnitCompare);
  if (!instrumentDupe.ok) {
    return invalidInput("instruments", `duplicate instrument ${instrumentDupe.duplicateKey}`);
  }

  const openOperations = input.openOperations ?? [];
  const operationIdDupe = sortUnique(
    openOperations,
    (op) => op.id,
    (a, b) => codeUnitCompare(a.id, b.id),
  );
  if (!operationIdDupe.ok) {
    return invalidInput("openOperations", `duplicate operation id ${operationIdDupe.duplicateKey}`);
  }

  const candleDupe = sortUnique(
    input.view.candles,
    (c) => `${c.ticker}|${c.timeframe}|${c.asOf}`,
    (a, b) =>
      codeUnitCompare(a.ticker, b.ticker) ||
      codeUnitCompare(a.timeframe, b.timeframe) ||
      compareInstants(a.asOf, b.asOf),
  );
  if (!candleDupe.ok) {
    return invalidInput("view.candles", `duplicate candle row for ${candleDupe.duplicateKey}`);
  }

  for (const [index, c] of input.view.candles.entries()) {
    for (const field of priceFields) {
      if (!isPositiveDecimal(c[field])) {
        return invalidInput(
          `view.candles[${String(index)}].${field}`,
          "a candle's open, high, low and close must be strictly positive",
        );
      }
    }
  }

  const factorDupe = sortUnique(
    input.view.corporateActions,
    (f) => `${f.ticker}|${f.exDate}`,
    (a, b) => codeUnitCompare(a.ticker, b.ticker) || codeUnitCompare(a.exDate, b.exDate),
  );
  if (!factorDupe.ok) {
    return invalidInput(
      "view.corporateActions",
      `duplicate corporate action factor for ${factorDupe.duplicateKey}`,
    );
  }

  for (const [index, f] of input.view.corporateActions.entries()) {
    if (!isPositiveDecimal(f.factor)) {
      return invalidInput(
        `view.corporateActions[${String(index)}].factor`,
        "a corporate-action factor must be strictly positive",
      );
    }
  }

  const macroDupe = sortUnique(
    input.view.macro,
    (m) => `${m.series}|${m.asOf}`,
    (a, b) => codeUnitCompare(a.series, b.series) || compareInstants(a.asOf, b.asOf),
  );
  if (!macroDupe.ok) {
    return invalidInput("view.macro", `duplicate macro point for ${macroDupe.duplicateKey}`);
  }

  const dividendDupe = sortUnique(
    input.view.dividendYields,
    (d) => `${d.underlying}|${d.asOf}`,
    (a, b) => codeUnitCompare(a.underlying, b.underlying) || compareInstants(a.asOf, b.asOf),
  );
  if (!dividendDupe.ok) {
    return invalidInput(
      "view.dividendYields",
      `duplicate dividend yield point for ${dividendDupe.duplicateKey}`,
    );
  }

  for (const [index, m] of input.view.macro.entries()) {
    if (parseDecimal(m.annualRate).lte(-1)) {
      return invalidInput(
        `view.macro[${String(index)}].annualRate`,
        "an annual rate of -100% or below makes ln(1 + rate) undefined",
      );
    }
  }

  for (const [index, d] of input.view.dividendYields.entries()) {
    if (parseDecimal(d.annualYield).lte(-1)) {
      return invalidInput(
        `view.dividendYields[${String(index)}].annualYield`,
        "an annual yield of -100% or below makes ln(1 + yield) undefined",
      );
    }
  }

  return null;
}

function partitionByTicker<T extends { ticker: Ticker }>(rows: readonly T[]): Map<Ticker, T[]> {
  const byTicker = new Map<Ticker, T[]>();
  for (const row of rows) {
    const bucket = byTicker.get(row.ticker);
    if (bucket) bucket.push(row);
    else byTicker.set(row.ticker, [row]);
  }
  return byTicker;
}

type ExitRuleBases = { premiumBase: Decimal; maxLossBase: Decimal };

function computeExitRuleBases(op: Operation, view: MarketView, at: Instant): ExitRuleBases {
  const firstLeg = assertDefined(
    op.legs[0],
    "evaluateStrategy: an operation always carries at least one leg",
  );
  const result = priceStockLegs({
    at,
    underlying: op.underlying,
    spot: firstLeg.entryPrice,
    legs: op.legs.map((leg) => ({ ...leg, priceSource: "given" as const })),
    view,
    provenanceBase: {
      engineVersion: ENGINE_VERSION,
      pricingModel: "bsm_continuous_yield",
      dataVersion: null,
      datasetNotes: [],
    },
  });
  // validateBatchInvariants rejects any macro/dividendYields point with an annual rate at
  // or below -1 before evaluation reaches an operation's exit rules, so priceStockLegs
  // cannot fail here.
  invariant(result.ok, "computeExitRuleBases: view invariants were already validated");
  const pricing = result.value;
  const premiumBase = new Decimal(Math.abs(pricing.netPremium));
  const maxLossBase = pricing.maxLoss === "unbounded" ? premiumBase : new Decimal(pricing.maxLoss);
  return { premiumBase, maxLossBase };
}

function evaluateNumericExitRule(
  rule: Extract<ExitRule, { kind: "profit_target" | "stop_loss" }>,
  op: Operation,
  currentClose: DecimalString,
  bases: ExitRuleBases,
  splitFactor: Decimal,
): { fired: boolean; zeroBase: boolean } {
  // Quantity and entryPrice are true money on the scale the operation was opened at; the
  // nominal close is on today's scale, so it is the close, not the entry price, that gets
  // rebased before the two are compared (ADR-0013 "Exit rule evaluation").
  const currentOnEntryScale = parseDecimal(currentClose).div(splitFactor);
  let pnlCentavos = new Decimal(0);
  for (const leg of op.legs) {
    const entry = parseDecimal(leg.entryPrice);
    const legSign = leg.side === "buy" ? 1 : -1;
    pnlCentavos = pnlCentavos.add(
      currentOnEntryScale.sub(entry).mul(legSign).mul(CENTAVOS_PER_REAL).mul(leg.quantity),
    );
  }
  if (rule.kind === "profit_target") {
    if (bases.premiumBase.lte(0)) return { fired: false, zeroBase: true };
    return {
      fired: pnlCentavos.gte(bases.premiumBase.mul(parseDecimal(rule.fractionOfPremium))),
      zeroBase: false,
    };
  }
  if (bases.maxLossBase.lte(0)) return { fired: false, zeroBase: true };
  return {
    fired: pnlCentavos.lte(bases.maxLossBase.mul(parseDecimal(rule.multipleOfMaxLoss)).neg()),
    zeroBase: false,
  };
}

function zeroBaseMessage(kind: "profit_target" | "stop_loss"): string {
  const baseName = kind === "profit_target" ? "premium" : "max-loss";
  return `${kind} cannot fire: the operation's ${baseName} base is zero`;
}

export function evaluateStrategy(input: EvaluateStrategyInput): Result<Evaluation> {
  const coherenceError = validateCoherence(input);
  if (coherenceError) return coherenceError;

  const hasOptionLegs = input.strategy.structure.legs.some((leg) => leg.role !== "stock");
  if (hasOptionLegs) {
    const firstStrike = assertDefined(
      input.strategy.definition.strikes[0],
      "evaluateStrategy: coherence guarantees at least one strike selection for option legs",
    );
    return {
      ok: false,
      error: { code: "unsupported", vocabulary: "strikeSelections", kind: firstStrike.kind },
    };
  }

  if (input.since !== undefined && compareInstants(input.since, input.at) >= 0) {
    return invalidInput("since", "since must be strictly before at");
  }

  const openOperationsError = validateOpenOperations(input);
  if (openOperationsError) return openOperationsError;

  const batchError = validateBatchInvariants(input);
  if (batchError) return batchError;

  const openOperations = input.openOperations ?? [];
  const distinctSpecs = dedupeIndicatorSpecs(collectIndicatorSpecs(input.strategy.definition));
  const needsIv = distinctSpecs.some((spec) => spec.kind === "iv_rank");

  const truncated = batchTruncationReport({
    candles: input.view.candles,
    corporateActions: input.view.corporateActions,
    impliedVolatilityIndex: input.view.impliedVolatilityIndex,
    macro: input.view.macro,
    dividendYields: input.view.dividendYields,
    instruments: input.instruments,
    at: input.at,
    needsIv,
  });

  const signals: Signal[] = [];
  const evaluations: EvaluationRecord[] = [];
  const timeframe = input.strategy.definition.timeframe;

  const candlesByTicker = partitionByTicker<Candle>(input.view.candles);
  const actionsByTicker = partitionByTicker<CorporateActionFactor>(input.view.corporateActions);

  for (const ticker of input.instruments) {
    const tickerView: MarketView = {
      ...input.view,
      candles: candlesByTicker.get(ticker) ?? [],
      corporateActions: actionsByTicker.get(ticker) ?? [],
    };

    const nominalSeries = buildCandleSeries({
      candles: tickerView.candles,
      corporateActions: tickerView.corporateActions,
      ticker,
      timeframe,
      at: input.at,
    });
    if (!nominalSeries.ok) {
      return invalidInput(nominalSeries.error.path, nominalSeries.error.message);
    }

    if (nominalSeries.value.nominal.length === 0) {
      evaluations.push(
        record(
          ticker,
          input.at,
          sessionForInstant(input.view.calendar, input.at),
          "insufficient_data",
          "no candles for this instrument and timeframe",
        ),
      );
      continue;
    }

    const instants =
      input.since !== undefined
        ? nominalSeries.value.nominal.filter(
            (c) => isAfter(c.asOf, input.since as string) && isAtOrBefore(c.asOf, input.at),
          )
        : [
            assertDefined(
              nominalSeries.value.nominal.at(-1),
              "evaluateStrategy: missing latest candle",
            ),
          ];

    if (instants.length === 0) {
      evaluations.push(
        record(
          ticker,
          input.at,
          sessionForInstant(input.view.calendar, input.at),
          "insufficient_data",
          "no candles in (since, at] for this instrument and timeframe",
        ),
      );
      continue;
    }

    const opsForTicker = openOperations.filter((op) => op.underlying === ticker);
    const basesByOpId = new Map(
      opsForTicker.map((op) => [op.id, computeExitRuleBases(op, input.view, input.at)] as const),
    );

    for (const nominalCandle of instants) {
      const c = nominalCandle.asOf;
      const activeOps = opsForTicker.filter((op) => op.openedAt <= nominalCandle.session);

      const indicatorsResult = computeIndicators({
        view: tickerView,
        ticker,
        timeframe,
        indicators: distinctSpecs,
        at: c,
        form: "adjusted",
      });
      if (!indicatorsResult.ok) return { ok: false, error: indicatorsResult.error };

      const currentAdjusted = assertDefined(
        indicatorsResult.value.candles.at(-1),
        "evaluateStrategy: missing current adjusted candle",
      );
      const rawIndicatorValues = new Map<string, DecimalString | null>();
      for (const series of indicatorsResult.value.series) {
        rawIndicatorValues.set(
          indicatorSpecKey(series.indicator),
          assertDefined(series.values.at(-1), "evaluateStrategy: missing indicator value"),
        );
      }
      const decimalIndicatorValues = new Map<string, Decimal | null>(
        [...rawIndicatorValues.entries()].map(([key, value]) => [
          key,
          value === null ? null : parseDecimal(value),
        ]),
      );
      const ctx: ConditionContext = {
        candle: currentAdjusted,
        indicatorValues: decimalIndicatorValues,
      };

      if (activeOps.length === 0) {
        const entryVerdict = evaluateCondition(input.strategy.definition.entry, ctx);
        if (entryVerdict === "unknown") {
          evaluations.push(
            record(
              ticker,
              c,
              nominalCandle.session,
              "insufficient_data",
              "entry condition needs more warm-up data",
            ),
          );
          continue;
        }
        if (entryVerdict === "false") {
          evaluations.push(record(ticker, c, nominalCandle.session, "conditions_not_met", null));
          continue;
        }

        const legs = input.strategy.structure.legs;
        const sizingResult = sizeStockEntry({
          sizing: input.strategy.definition.sizing,
          declaredCapital: input.riskProfile?.declaredCapital ?? null,
          legs: legs.map((leg) => ({ side: leg.side, ratio: leg.ratio })),
          price: nominalCandle.close,
        });
        if (!sizingResult.ok) {
          evaluations.push(
            record(
              ticker,
              c,
              nominalCandle.session,
              "unsizeable",
              sizingDetail[sizingResult.detail],
            ),
          );
          continue;
        }

        const operationLegs: OperationLeg[] = legs.map((leg) => ({
          role: "stock",
          side: leg.side,
          ticker,
          quantity: toQuantity(leg.ratio * sizingResult.units),
          entryPrice: nominalCandle.close,
        }));
        const stockPricingResult = priceStockLegs({
          at: c,
          underlying: ticker,
          spot: nominalCandle.close,
          legs: operationLegs.map((leg) => ({ ...leg, priceSource: "close" as const })),
          view: input.view,
          riskProfile: input.riskProfile,
          openOperationCount: openOperations.filter((op) => op.openedAt <= nominalCandle.session)
            .length,
          provenanceBase: {
            engineVersion: ENGINE_VERSION,
            pricingModel: "bsm_continuous_yield",
            dataVersion: input.view.dataVersion ?? null,
            datasetNotes: input.view.datasetNotes ?? [],
          },
        });
        // validateBatchInvariants rejects any macro/dividendYields point with an annual
        // rate at or below -1 before this loop prices an entry, so priceStockLegs cannot
        // fail here.
        invariant(stockPricingResult.ok, "signal pricing: view invariants were already validated");
        const pricing = stockPricingResult.value;
        const entrySpecs = dedupeIndicatorSpecs(
          collectSpecsFromCondition(input.strategy.definition.entry),
        );
        const indicators: IndicatorReading[] = entrySpecs.map((spec) => ({
          indicator: spec,
          value: rawIndicatorValues.get(indicatorSpecKey(spec)) ?? null,
        }));
        signals.push({
          kind: "entry",
          strategyVersionId: input.strategy.id,
          ticker,
          timeframe,
          at: c,
          session: nominalCandle.session,
          indicators,
          proposal: {
            legs: operationLegs.map((leg) => ({
              role: leg.role,
              side: leg.side,
              ticker: leg.ticker,
              quantity: leg.quantity,
            })),
            pricing,
          },
        });
        evaluations.push(record(ticker, c, nominalCandle.session, "signal", null));
        continue;
      }

      let instantFired = false;
      let instantUnknown = false;
      let zeroBaseDetail: string | null = null;
      for (const op of activeOps) {
        const bases = assertDefined(
          basesByOpId.get(op.id),
          "evaluateStrategy: missing precomputed exit rule bases",
        );
        const visibleFactors = tickerView.corporateActions.filter((f) => isAtOrBefore(f.asOf, c));
        const splitFactorResult = splitFactorProduct(
          visibleFactors,
          op.openedAt,
          nominalCandle.session,
        );
        if (!splitFactorResult.ok) return { ok: false, error: splitFactorResult.error };
        const splitFactor = splitFactorResult.value;
        let fired = false;
        for (const rule of input.strategy.definition.exit) {
          if (fired) break;
          switch (rule.kind) {
            case "profit_target":
            case "stop_loss": {
              const outcome = evaluateNumericExitRule(
                rule,
                op,
                nominalCandle.close,
                bases,
                splitFactor,
              );
              if (outcome.zeroBase && zeroBaseDetail === null) {
                zeroBaseDetail = zeroBaseMessage(rule.kind);
              }
              if (outcome.fired) {
                signals.push({
                  kind: "exit",
                  strategyVersionId: input.strategy.id,
                  ticker,
                  timeframe,
                  at: c,
                  session: nominalCandle.session,
                  indicators: [],
                  operationId: op.id,
                  rule,
                });
                fired = true;
              }
              break;
            }
            case "condition": {
              const verdict = evaluateCondition(rule.condition, ctx);
              if (verdict === "true") {
                const ruleSpecs = dedupeIndicatorSpecs(collectSpecsFromCondition(rule.condition));
                const indicators: IndicatorReading[] = ruleSpecs.map((spec) => ({
                  indicator: spec,
                  value: rawIndicatorValues.get(indicatorSpecKey(spec)) ?? null,
                }));
                signals.push({
                  kind: "exit",
                  strategyVersionId: input.strategy.id,
                  ticker,
                  timeframe,
                  at: c,
                  session: nominalCandle.session,
                  indicators,
                  operationId: op.id,
                  rule,
                });
                fired = true;
              } else if (verdict === "unknown") {
                instantUnknown = true;
              }
              break;
            }
            case "days_before_expiry":
              throw new Error(
                "evaluateStrategy: days_before_expiry exit rule on a stock-only strategy; coherence validation should have rejected this",
              );
          }
        }
        if (fired) instantFired = true;
      }
      evaluations.push(
        record(
          ticker,
          c,
          nominalCandle.session,
          instantFired ? "signal" : instantUnknown ? "insufficient_data" : "conditions_not_met",
          instantFired ? null : zeroBaseDetail,
        ),
      );
    }
  }

  return {
    ok: true,
    value: {
      signals,
      evaluations,
      notes: [],
      provenance: {
        engineVersion: ENGINE_VERSION,
        pricingModel: "bsm_continuous_yield",
        truncated,
        dataVersion: input.view.dataVersion ?? null,
        datasetNotes: input.view.datasetNotes ?? [],
      },
    },
  };
}
