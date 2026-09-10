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
  type LegInput,
  type MarketView,
  type Operation,
  type OperationLeg,
  type Result,
  type Signal,
  type TradingSession,
} from "../api";
import { batchTruncationReport } from "./batch-truncation";
import { buildCandleSeries, isPositiveDecimal, priceFields } from "./candle-series";
import { sessionAtOrBefore, sortedCalendar } from "./calendar";
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
import { assertDefined, assertPresent, invariant } from "./invariant";
import { validateOperationCoherence } from "./operation-coherence";
import { codeUnitCompare, sortUnique } from "./order";
import { priceLegsAt, priceOperation } from "./price-operation";
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

// Mirrored by `checkStrategyCoherence` in `packages/contracts/src/strategy-coherence.ts`
// (ADR-0013): this package cannot import that one at runtime, and that one
// cannot import this one, so the two copies are kept in sync by
// `apps/web/src/modules/strategies/coherence-conformance.test.ts` rather than
// by a shared function.
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

// Delegates the rest of an open operation's coherence to `validateOperationCoherence`
// (round 2 item 3): a hand-rolled copy here previously skipped `series.underlying`,
// `series.right` and `openedAt <= at`, so `evaluateStrategy` accepted an operation
// `markToMarket` would reject.
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
    const coherenceError = validateOperationCoherence(
      input.view,
      op,
      input.at,
      `openOperations[${String(index)}]`,
    );
    if (coherenceError) return { ok: false, error: coherenceError };
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

const exitRuleProvenanceBase: {
  engineVersion: string;
  pricingModel: "bsm_continuous_yield";
  dataVersion: null;
  datasetNotes: string[];
} = {
  engineVersion: ENGINE_VERSION,
  pricingModel: "bsm_continuous_yield",
  dataVersion: null,
  datasetNotes: [],
};

// Both a stock-only and an option operation share one pricing path (priceLegsAt): every leg
// is priced "given" at its own entryPrice, so the base never drifts as the position moves
// (ADR-0014 Q50). `priceLegsAt` resolves the underlying's own current spot and rates itself
// (round 1 item 13: an earlier draft passed the first leg's own entryPrice as the spot, which
// for an option-led leg order priced an underlying against an option premium); called once
// per instant `c` a caller's evaluation batch visits, not once for the whole batch at `at`
// (an option leg's time-to-expiry and its rates both move within a since..at catch-up, so a
// base resolved once at the batch's own `at` would let an earlier instant see a later
// instant's rates). Pricing itself can still fail for an option leg whose series has fallen
// out of the view (a caller passing a stale or incomplete window for an operation it still
// holds open), or the underlying's own spot being momentarily unresolvable: that is reported
// to the caller as "cannot evaluate this operation's exit rules right now", not an invariant.
function computeExitRuleBases(op: Operation, view: MarketView, at: Instant): ExitRuleBases | null {
  const legs: LegInput[] = op.legs.map((leg) => ({
    role: leg.role,
    side: leg.side,
    ticker: leg.ticker,
    quantity: leg.quantity,
    price: leg.entryPrice,
  }));
  const result = priceLegsAt(
    view,
    at,
    op.underlying,
    legs,
    undefined,
    undefined,
    exitRuleProvenanceBase,
    "spot",
  );
  if (!result.ok) return null;
  const pricing = result.value;
  const premiumBase = new Decimal(Math.abs(pricing.netPremium));
  const maxLossBase = pricing.maxLoss === "unbounded" ? premiumBase : new Decimal(pricing.maxLoss);
  return { premiumBase, maxLossBase };
}

// The current side of a profit_target/stop_loss comparison prices every leg through the
// same `priceLegsAt` seam `computeExitRuleBases` already uses for the base side (round 2
// item 2): one call, one spot (priceLegsAt's own quote-mid/last/close ladder), one rate
// resolution, per operation per instant — never a second, stale-unaware pricing ladder
// re-implemented here leg by leg against a different spot (`currentClose`) than the base
// was computed against. An option leg's own listed series is exchange-adjusted for a
// corporate action of the underlying (a new ticker is listed post-adjustment); only the
// stock leg's own ticker persists unchanged through a split, so only a stock leg's premium
// is rebased onto `op.legs[i].entryPrice`'s own scale before the diff (ADR-0013 "Exit rule
// evaluation", extended by the #23 addendum) — `splitFactor` is always 1 for an option leg
// (Q51: a split forces a series rollover, never a factor on the option's own ticker), so
// dividing by it is a no-op there.
function evaluateNumericExitRule(
  rule: Extract<ExitRule, { kind: "profit_target" | "stop_loss" }>,
  op: Operation,
  view: MarketView,
  at: Instant,
  bases: ExitRuleBases,
  splitFactor: Decimal,
): { fired: boolean; zeroBase: boolean; unknown: boolean } {
  const legs: LegInput[] = op.legs.map((leg) => ({
    role: leg.role,
    side: leg.side,
    ticker: leg.ticker,
    quantity: leg.quantity,
  }));
  const pricingResult = priceLegsAt(
    view,
    at,
    op.underlying,
    legs,
    undefined,
    undefined,
    exitRuleProvenanceBase,
    "spot",
  );
  // This call shares its view, at, underlying and every leg's ticker with
  // computeExitRuleBases's own priceLegsAt call above it, which already gated this op on
  // `bases === null` before evaluateNumericExitRule is ever invoked: every hard failure
  // priceLegsAt can produce (missing_instrument, a non-positive spot/strike, an
  // already-expired leg, a macro/dividend read) depends only on those shared inputs, never
  // on whether a leg's own price is given (bases's own legs) or resolved (this call's), so
  // this branch cannot fail once bases has already succeeded for the same op at the same
  // instant.
  /* v8 ignore next */
  if (!pricingResult.ok) return { fired: false, zeroBase: false, unknown: true };
  let pnlCentavos = new Decimal(0);
  for (const [index, leg] of op.legs.entries()) {
    const valuation = pricingResult.value.legs[index];
    // `valueOneLeg` only ever produces a `fairValue` from a `sigma` it either solved from a
    // real market price (in which case `price` is already non-null, taking the branch
    // above) or was given directly on the `LegInput` (never true here: this call's own legs
    // never carry `volatility`) — so `fairValue` is provably always null whenever `price`
    // is, making that fallback dead for this caller specifically. Read here anyway, never
    // simplified away, to stay the same shape `price ?? fairValue` reads everywhere else in
    // the engine (round 2 item 2) and to keep working if valueOneLeg ever gains another way
    // to produce a fairValue without a market price.
    const rawPremium = valuation?.price
      ? parseDecimal(valuation.price)
      : /* v8 ignore next */
        valuation?.fairValue
        ? parseDecimal(valuation.fairValue)
        : null;
    if (rawPremium === null) return { fired: false, zeroBase: false, unknown: true };
    const currentPremium = leg.role === "stock" ? rawPremium.div(splitFactor) : rawPremium;
    const legSign = leg.side === "buy" ? 1 : -1;
    const entry = parseDecimal(leg.entryPrice);
    pnlCentavos = pnlCentavos.add(
      currentPremium.sub(entry).mul(legSign).mul(CENTAVOS_PER_REAL).mul(leg.quantity),
    );
  }
  if (rule.kind === "profit_target") {
    if (bases.premiumBase.lte(0)) return { fired: false, zeroBase: true, unknown: false };
    return {
      fired: pnlCentavos.gte(bases.premiumBase.mul(parseDecimal(rule.fractionOfPremium))),
      zeroBase: false,
      unknown: false,
    };
  }
  if (bases.maxLossBase.lte(0)) return { fired: false, zeroBase: true, unknown: false };
  return {
    fired: pnlCentavos.lte(bases.maxLossBase.mul(parseDecimal(rule.multipleOfMaxLoss)).neg()),
    zeroBase: false,
    unknown: false,
  };
}

function businessDaysBeforeExpiry(
  calendar: readonly TradingSession[],
  at: Instant,
  expiry: SessionDate,
): number | null {
  const sorted = sortedCalendar(calendar);
  const atSession = sessionAtOrBefore(calendar, at);
  if (!atSession) return null;
  const expiryIndex = sorted.findIndex((session) => session.date === expiry);
  if (expiryIndex < 0) return null;
  const atIndex = sorted.indexOf(atSession);
  return expiryIndex - atIndex;
}

function zeroBaseMessage(kind: "profit_target" | "stop_loss"): string {
  const baseName = kind === "profit_target" ? "premium" : "max-loss";
  return `${kind} cannot fire: the operation's ${baseName} base is zero`;
}

export function evaluateStrategy(input: EvaluateStrategyInput): Result<Evaluation> {
  const coherenceError = validateCoherence(input);
  if (coherenceError) return coherenceError;

  const hasOptionLegs = input.strategy.structure.legs.some((leg) => leg.role !== "stock");

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

        const openOperationCount = openOperations.filter(
          (op) => op.openedAt <= nominalCandle.session,
        ).length;
        const entrySpecs = dedupeIndicatorSpecs(
          collectSpecsFromCondition(input.strategy.definition.entry),
        );
        const indicators: IndicatorReading[] = entrySpecs.map((spec) => ({
          indicator: spec,
          value: rawIndicatorValues.get(indicatorSpecKey(spec)) ?? null,
        }));

        if (hasOptionLegs) {
          // Strike/expiry selection and pricing for an option structure are priceOperation's
          // own job (ADR-0013's #23 addendum): evaluateStrategy never re-implements
          // resolveLegSelection or the payoff model, it builds the same LegSelection a
          // human-priced proposal would use and calls the one public pricing seam.
          const expiry = assertDefined(
            input.strategy.definition.expiry,
            "evaluateStrategy: coherence guarantees an expiry selection for option legs",
          );
          const entryPricing = priceOperation(
            {
              view: input.view,
              at: c,
              legs: {
                structure: input.strategy.structure,
                underlying: ticker,
                strikes: input.strategy.definition.strikes,
                expiry,
                quantity: input.strategy.definition.sizing,
              },
              openOperationCount,
              ...(input.riskProfile !== undefined ? { riskProfile: input.riskProfile } : {}),
            },
            {
              engineVersion: ENGINE_VERSION,
              pricingModel: "bsm_continuous_yield",
              dataVersion: input.view.dataVersion ?? null,
              datasetNotes: input.view.datasetNotes ?? [],
            },
          );
          if (!entryPricing.ok) {
            switch (entryPricing.error.code) {
              case "no_series_matches":
                evaluations.push(
                  record(
                    ticker,
                    c,
                    nominalCandle.session,
                    "no_series_match",
                    "no listed option series satisfies the strike and expiry selection",
                  ),
                );
                continue;
              case "degenerate_strikes":
                evaluations.push(
                  record(
                    ticker,
                    c,
                    nominalCandle.session,
                    "degenerate_strikes",
                    "two distinct strike ranks resolved to the same listed strike",
                  ),
                );
                continue;
              case "unsizeable":
                evaluations.push(
                  record(
                    ticker,
                    c,
                    nominalCandle.session,
                    "unsizeable",
                    sizingDetail[entryPricing.error.reason],
                  ),
                );
                continue;
              case "insufficient_data":
                evaluations.push(
                  record(
                    ticker,
                    c,
                    nominalCandle.session,
                    "insufficient_data",
                    "not enough market data to select strikes or price the proposal",
                  ),
                );
                continue;
              default:
                return { ok: false, error: entryPricing.error };
            }
          }
          const pricing = entryPricing.value;
          signals.push({
            kind: "entry",
            strategyVersionId: input.strategy.id,
            ticker,
            timeframe,
            at: c,
            session: nominalCandle.session,
            indicators,
            proposal: { legs: pricing.legs.map((legValuation) => legValuation.leg), pricing },
          });
          evaluations.push(record(ticker, c, nominalCandle.session, "signal", null));
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
          openOperationCount,
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
        // Resolved at this same instant `c`, not once for the whole since..at batch at
        // `input.at` (round 1 item 13): an option leg's time-to-expiry and rates both move
        // within a catch-up batch, so a base resolved once at the batch's own end would let
        // an earlier instant see a later instant's rates.
        const bases = computeExitRuleBases(op, input.view, c);
        if (bases === null) {
          instantUnknown = true;
          continue;
        }
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
              const outcome = evaluateNumericExitRule(rule, op, input.view, c, bases, splitFactor);
              if (outcome.unknown) {
                instantUnknown = true;
                break;
              }
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
            case "days_before_expiry": {
              // Coherence rejects days_before_expiry on a stock-only definition, so an
              // active operation reaching this branch always carries an expiry.
              const expiry = assertPresent(
                op.expiry,
                "evaluateStrategy: an operation with option legs always carries an expiry",
              );
              const remaining = businessDaysBeforeExpiry(input.view.calendar, c, expiry);
              // computeExitRuleBases already resolved a time to expiry for this same
              // operation's option leg(s), against this same view.calendar and instant, so
              // the session-index lookup here cannot fail once activeOps reaches this op:
              // any calendar or expiry that could make it fail would have already made
              // computeExitRuleBases return null and this op never reach this switch.
              /* v8 ignore start */
              if (remaining === null) {
                instantUnknown = true;
                break;
              }
              /* v8 ignore stop */
              if (remaining <= rule.businessDays) {
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
