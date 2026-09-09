import Decimal from "decimal.js";
import type { DecimalString, ExitRule } from "@fetha/contracts";
import {
  ENGINE_VERSION,
  type Evaluation,
  type EvaluationOutcome,
  type EvaluationRecord,
  type EvaluateStrategyInput,
  type IndicatorReading,
  type Operation,
  type OperationLeg,
  type Result,
  type Signal,
} from "../api";
import { batchTruncationReport } from "./batch-truncation";
import { buildCandleSeries } from "./candle-series";
import {
  collectIndicatorSpecs,
  collectSpecsFromCondition,
  dedupeIndicatorSpecs,
  indicatorSpecKey,
} from "./collect-indicator-specs";
import { evaluateCondition, type ConditionContext } from "./condition-evaluator";
import { parseDecimal } from "./decimal";
import { computeIndicators } from "./indicators-computation";
import { compareInstants, isAfter, isAtOrBefore } from "./instant";
import { assertDefined } from "./invariant";
import { toQuantity } from "./scalars";
import { sizeStockEntry, type StockSizingReason } from "./sizing";
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
  ticker: string,
  at: string,
  session: string,
  outcome: EvaluationOutcome,
  detail: string | null,
): EvaluationRecord {
  return { ticker, at, session, outcome, detail };
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
  }
  return null;
}

function evaluateNumericExitRule(
  rule: Extract<ExitRule, { kind: "profit_target" | "stop_loss" }>,
  op: Operation,
  currentClose: DecimalString,
): boolean {
  const current = parseDecimal(currentClose);
  let pnl = new Decimal(0);
  let cost = new Decimal(0);
  for (const leg of op.legs) {
    const entry = parseDecimal(leg.entryPrice);
    const legSign = leg.side === "buy" ? 1 : -1;
    pnl = pnl.add(current.sub(entry).mul(legSign).mul(leg.quantity));
    cost = cost.add(entry.mul(leg.quantity));
  }
  if (rule.kind === "profit_target") {
    return pnl.gte(cost.mul(parseDecimal(rule.fractionOfPremium)));
  }
  return pnl.lte(cost.mul(parseDecimal(rule.multipleOfMaxLoss)).neg());
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

  for (const ticker of input.instruments) {
    const nominalSeries = buildCandleSeries({
      candles: input.view.candles,
      corporateActions: input.view.corporateActions,
      ticker,
      timeframe,
      at: input.at,
    });
    if (!nominalSeries.ok) {
      return invalidInput(nominalSeries.error.path, nominalSeries.error.message);
    }

    const instants =
      input.since !== undefined
        ? nominalSeries.value.nominal.filter(
            (c) => isAfter(c.asOf, input.since as string) && isAtOrBefore(c.asOf, input.at),
          )
        : nominalSeries.value.nominal.length > 0
          ? [
              assertDefined(
                nominalSeries.value.nominal.at(-1),
                "evaluateStrategy: missing latest candle",
              ),
            ]
          : [];

    const opsForTicker = openOperations.filter((op) => op.underlying === ticker);

    for (const nominalCandle of instants) {
      const c = nominalCandle.asOf;
      const indicatorsResult = computeIndicators({
        view: input.view,
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

      if (opsForTicker.length === 0) {
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
        const pricing = priceStockLegs({
          at: c,
          underlying: ticker,
          spot: nominalCandle.close,
          legs: operationLegs.map((leg) => ({ ...leg, priceSource: "close" as const })),
          view: input.view,
          riskProfile: input.riskProfile,
          openOperationCount: openOperations.length,
          provenanceBase: {
            engineVersion: ENGINE_VERSION,
            pricingModel: "bsm_continuous_yield",
            dataVersion: input.view.dataVersion ?? null,
            datasetNotes: input.view.datasetNotes ?? [],
          },
        });
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
      for (const op of opsForTicker) {
        let fired = false;
        for (const rule of input.strategy.definition.exit) {
          if (fired) break;
          switch (rule.kind) {
            case "profit_target":
            case "stop_loss": {
              if (evaluateNumericExitRule(rule, op, nominalCandle.close)) {
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
          null,
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
