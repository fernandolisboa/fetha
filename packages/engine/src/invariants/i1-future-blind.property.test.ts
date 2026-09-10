import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  Candle,
  CorporateActionFactor,
  EvaluateStrategyInput,
  Evaluation,
  ImpliedVolatilityIndexPoint,
  IndicatorSeries,
  IndicatorsInput,
  MarketView,
  Operation,
  Result,
  StrategyVersion,
} from "../api";
import { evaluateStrategy } from "../internal/evaluate-strategy";
import { computeIndicators } from "../internal/indicators-computation";
import { assertDefined } from "../internal/invariant";
import { instantMs } from "../internal/instant";
import { runBacktest } from "../internal/run-backtest";
import { centavos, decimalString, quantity } from "../test/support";
import {
  candlePriceArbitrary,
  candleSeriesArbitrary,
  longBacktestFixtureArbitrary,
} from "./arbitraries";

const riskProfile = {
  declaredCapital: centavos(1_000_000_00),
  limits: {
    maxLossPerOperation: decimalString("1"),
    maxExposurePerOperation: decimalString("1"),
    maxOpenOperations: 100,
    maxPremiumBought: decimalString("1"),
  },
};

// The ADR states appending future rows never changes the artifact, but that those rows
// do appear in provenance.truncated (a growing count), so the comparison strips it,
// mirroring I2's convention for the same reason.
const stripTruncated = (result: Result<IndicatorSeries>): unknown => {
  if (!result.ok) return result;
  const { provenance, ...rest } = result.value;
  return {
    ok: true,
    value: {
      ...rest,
      provenance: {
        engineVersion: provenance.engineVersion,
        pricingModel: provenance.pricingModel,
        dataVersion: provenance.dataVersion,
        datasetNotes: provenance.datasetNotes,
      },
    },
  };
};

const asOfPlusMs = (asOf: string, ms: number): string =>
  new Date(instantMs(asOf) + ms).toISOString();

const futureCandleAt = (asOf: string, close: string): Candle => ({
  ticker: "PETR4",
  timeframe: "D1",
  session: asOf.slice(0, 10),
  asOf,
  open: decimalString(close),
  high: decimalString(close),
  low: decimalString(close),
  close: decimalString(close),
  tradedQuantity: 1,
});

const futureCandle = (index: number, close: string): Candle => {
  const session = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
  return futureCandleAt(`${session}T21:00:00.000Z`, close);
};

const futureFactor = (index: number): CorporateActionFactor => {
  const exDate = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
  return {
    ticker: "PETR4",
    exDate,
    asOf: `${exDate}T13:00:00.000Z`,
    factor: decimalString("0.5"),
  };
};

describe("I1 Future-blind", () => {
  it("appending candles and a corporate-action factor with asOf after the truncation instant never changes the artifact", () => {
    fc.assert(
      fc.property(
        candleSeriesArbitrary,
        fc.array(candlePriceArbitrary, { minLength: 0, maxLength: 5 }),
        (candles, extraPrices) => {
          fc.pre(candles.length >= 3);
          const truncationIndex = Math.floor(candles.length / 2);
          const truncationCandle = assertDefined(
            candles[truncationIndex],
            "test setup: missing truncation candle",
          );
          const earliestCandle = assertDefined(candles[0], "test setup: missing earliest candle");
          const view = (
            extra: Candle[],
            factors: CorporateActionFactor[],
          ): IndicatorsInput["view"] => ({
            calendar: [],
            candles: [...candles, ...extra],
            corporateActions: factors,
            optionSeries: [],
            optionPrices: [],
            quotes: [],
            macro: [],
            dividendYields: [],
            impliedVolatilityIndex: [],
          });
          const baseInput: IndicatorsInput = {
            view: view([], []),
            ticker: "PETR4",
            timeframe: "D1",
            indicators: [
              { kind: "sma", length: 3 },
              { kind: "atr", length: 3 },
            ],
            at: truncationCandle.asOf,
          };
          // The tightest boundary: a future row exactly 1 ms after the truncation
          // instant, plus further-out rows and a factor whose ex-date falls inside
          // the already-visible candle range but whose own asOf is still in the
          // future (so it must not retroactively adjust anything visible at `at`).
          const tightestFutureCandle = futureCandleAt(
            asOfPlusMs(truncationCandle.asOf, 1),
            extraPrices[0] ?? decimalString("10.00"),
          );
          const extraFutureCandles = extraPrices.slice(1).map((p, i) => futureCandle(i, p));
          const futureFactorInsideVisibleRange: CorporateActionFactor = {
            ticker: "PETR4",
            exDate: earliestCandle.session,
            asOf: asOfPlusMs(truncationCandle.asOf, 1),
            factor: decimalString("0.5"),
          };
          const extendedInput: IndicatorsInput = {
            ...baseInput,
            view: view(
              [tightestFutureCandle, ...extraFutureCandles],
              [futureFactor(0), futureFactorInsideVisibleRange],
            ),
          };
          expect(stripTruncated(computeIndicators(extendedInput))).toEqual(
            stripTruncated(computeIndicators(baseInput)),
          );
        },
      ),
    );
  });

  it("appending an implied-volatility index point with asOf after the truncation instant never changes iv_rank", () => {
    fc.assert(
      fc.property(candleSeriesArbitrary, (candles) => {
        fc.pre(candles.length >= 3);
        const truncationCandle = assertDefined(candles.at(-1), "test setup: missing candle");
        const visiblePoints: ImpliedVolatilityIndexPoint[] = candles.map((c) => ({
          underlying: "PETR4",
          session: c.session,
          asOf: c.asOf,
          impliedVolatility: decimalString("0.30"),
        }));
        const futurePoint: ImpliedVolatilityIndexPoint = {
          underlying: "PETR4",
          session: new Date(Date.UTC(2025, 0, 1)).toISOString().slice(0, 10),
          asOf: asOfPlusMs(truncationCandle.asOf, 1),
          impliedVolatility: decimalString("0.99"),
        };
        const view = (points: ImpliedVolatilityIndexPoint[]): IndicatorsInput["view"] => ({
          calendar: [],
          candles,
          corporateActions: [],
          optionSeries: [],
          optionPrices: [],
          quotes: [],
          macro: [],
          dividendYields: [],
          impliedVolatilityIndex: points,
        });
        const baseInput: IndicatorsInput = {
          view: view(visiblePoints),
          ticker: "PETR4",
          timeframe: "D1",
          indicators: [{ kind: "iv_rank", lookbackSessions: 2 }],
          at: truncationCandle.asOf,
        };
        const extendedInput: IndicatorsInput = {
          ...baseInput,
          view: view([...visiblePoints, futurePoint]),
        };
        expect(stripTruncated(computeIndicators(extendedInput))).toEqual(
          stripTruncated(computeIndicators(baseInput)),
        );
      }),
    );
  });
});

describe("I1 Future-blind — evaluateStrategy's inner evaluation instants", () => {
  const strategy: StrategyVersion = {
    id: "v1",
    definition: {
      name: "test",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "price", field: "close" },
        comparator: ">",
        right: { kind: "indicator", indicator: { kind: "sma", length: 3 } },
      },
      structureId: "stock",
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
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

  const stripProvenance = (result: Result<Evaluation>): unknown => {
    if (!result.ok) return result;
    return {
      ok: true,
      value: { signals: result.value.signals, evaluations: result.value.evaluations },
    };
  };

  it("appending a candle with asOf in (c, at] never changes the evaluation record or signal at the inner instant c", () => {
    let sawAtLeastOneSignal = false;
    fc.assert(
      fc.property(candleSeriesArbitrary, candlePriceArbitrary, (candles, extraPrice) => {
        fc.pre(candles.length >= 5);
        const c = assertDefined(candles[2], "test setup: missing inner instant candle").asOf;
        const at = assertDefined(candles.at(-1), "test setup: missing last candle").asOf;
        const firstCandle = assertDefined(candles[0], "test setup: missing first candle");

        const view = (extra: Candle[]): MarketView => ({
          calendar: [],
          candles: [...candles, ...extra],
          corporateActions: [],
          optionSeries: [],
          optionPrices: [],
          quotes: [],
          macro: [],
          dividendYields: [],
          impliedVolatilityIndex: [],
        });

        const input: EvaluateStrategyInput = {
          view: view([]),
          strategy,
          instruments: ["PETR4"],
          since: `${firstCandle.session}T00:00:00.000Z`,
          at,
          riskProfile,
        };

        const futureCandle: Candle = {
          ticker: "PETR4",
          timeframe: "D1",
          session: new Date(Date.UTC(2030, 0, 1)).toISOString().slice(0, 10),
          asOf: asOfPlusMs(c, 1),
          open: extraPrice,
          high: extraPrice,
          low: extraPrice,
          close: extraPrice,
          tradedQuantity: 1,
        };
        const extendedInput: EvaluateStrategyInput = { ...input, view: view([futureCandle]) };

        const baseResult = evaluateStrategy(input);
        const extendedResult = evaluateStrategy(extendedInput);
        expect(baseResult.ok).toBe(true);
        expect(extendedResult.ok).toBe(true);
        if (!baseResult.ok || !extendedResult.ok) return;
        if (baseResult.value.signals.length > 0) sawAtLeastOneSignal = true;

        const atC = <T extends { at: string }>(rows: T[]): T[] => rows.filter((r) => r.at === c);
        expect(
          stripProvenance({
            ok: true,
            value: {
              signals: atC(extendedResult.value.signals),
              evaluations: atC(extendedResult.value.evaluations),
              notes: [],
              provenance: extendedResult.value.provenance,
            },
          }),
        ).toEqual(
          stripProvenance({
            ok: true,
            value: {
              signals: atC(baseResult.value.signals),
              evaluations: atC(baseResult.value.evaluations),
              notes: [],
              provenance: baseResult.value.provenance,
            },
          }),
        );
      }),
    );
    expect(sawAtLeastOneSignal).toBe(true);
  });

  it("appending a corporate-action factor with asOf in (c, at] never changes the evaluation record or signal at the inner instant c", () => {
    let sawAtLeastOneSignal = false;
    fc.assert(
      fc.property(candleSeriesArbitrary, (candles) => {
        fc.pre(candles.length >= 5);
        const c = assertDefined(candles[2], "test setup: missing inner instant candle").asOf;
        const at = assertDefined(candles.at(-1), "test setup: missing last candle").asOf;
        const firstCandle = assertDefined(candles[0], "test setup: missing first candle");

        const view = (factors: CorporateActionFactor[]): MarketView => ({
          calendar: [],
          candles,
          corporateActions: factors,
          optionSeries: [],
          optionPrices: [],
          quotes: [],
          macro: [],
          dividendYields: [],
          impliedVolatilityIndex: [],
        });

        const input: EvaluateStrategyInput = {
          view: view([]),
          strategy,
          instruments: ["PETR4"],
          since: `${firstCandle.session}T00:00:00.000Z`,
          at,
          riskProfile,
        };

        // A factor whose asOf falls strictly after c (inside (c, at]) must not rewrite the
        // record already produced at c, even though its ex-date is inside the visible range.
        const laterFactor: CorporateActionFactor = {
          ticker: "PETR4",
          exDate: firstCandle.session,
          asOf: asOfPlusMs(c, 1),
          factor: decimalString("0.5"),
        };
        const extendedInput: EvaluateStrategyInput = { ...input, view: view([laterFactor]) };

        const baseResult = evaluateStrategy(input);
        const extendedResult = evaluateStrategy(extendedInput);
        expect(baseResult.ok).toBe(true);
        expect(extendedResult.ok).toBe(true);
        if (!baseResult.ok || !extendedResult.ok) return;
        if (baseResult.value.signals.length > 0) sawAtLeastOneSignal = true;

        const atC = <T extends { at: string }>(rows: T[]): T[] => rows.filter((r) => r.at === c);
        expect(
          stripProvenance({
            ok: true,
            value: {
              signals: atC(extendedResult.value.signals),
              evaluations: atC(extendedResult.value.evaluations),
              notes: [],
              provenance: extendedResult.value.provenance,
            },
          }),
        ).toEqual(
          stripProvenance({
            ok: true,
            value: {
              signals: atC(baseResult.value.signals),
              evaluations: atC(baseResult.value.evaluations),
              notes: [],
              provenance: baseResult.value.provenance,
            },
          }),
        );
      }),
    );
    expect(sawAtLeastOneSignal).toBe(true);
  });

  it("appending a portfolio operation with openedAt in (c, at] never changes the evaluation record or signal at the inner instant c", () => {
    let sawAtLeastOneSignal = false;
    fc.assert(
      fc.property(candleSeriesArbitrary, (candles) => {
        fc.pre(candles.length >= 5);
        const c = assertDefined(candles[2], "test setup: missing inner instant candle").asOf;
        const at = assertDefined(candles.at(-1), "test setup: missing last candle").asOf;
        const lastCandle = assertDefined(candles.at(-1), "test setup: missing last candle");
        const firstCandle = assertDefined(candles[0], "test setup: missing first candle");

        const view: MarketView = {
          calendar: [],
          candles,
          corporateActions: [],
          optionSeries: [],
          optionPrices: [],
          quotes: [],
          macro: [],
          dividendYields: [],
          impliedVolatilityIndex: [],
        };

        // maxOpenOperations: 1 makes the bug observable: if the future operation were
        // counted at c, the entry at c would breach the limit it must not see yet.
        const tightRiskProfile = {
          ...riskProfile,
          limits: { ...riskProfile.limits, maxOpenOperations: 1 },
        };

        const baseInput: EvaluateStrategyInput = {
          view,
          strategy,
          instruments: ["PETR4"],
          since: `${firstCandle.session}T00:00:00.000Z`,
          at,
          riskProfile: tightRiskProfile,
        };

        const futureOperation: Operation = {
          id: "future-op",
          underlying: "PETR4",
          legs: [
            {
              role: "stock",
              side: "buy",
              ticker: "PETR4",
              quantity: quantity(1),
              entryPrice: decimalString("1.00"),
            },
          ],
          expiry: null,
          openedAt: lastCandle.session,
          strategyVersionId: "v1",
          rolledFrom: null,
        };
        const extendedInput: EvaluateStrategyInput = {
          ...baseInput,
          openOperations: [futureOperation],
        };

        const baseResult = evaluateStrategy(baseInput);
        const extendedResult = evaluateStrategy(extendedInput);
        expect(baseResult.ok).toBe(true);
        expect(extendedResult.ok).toBe(true);
        if (!baseResult.ok || !extendedResult.ok) return;
        if (baseResult.value.signals.length > 0) sawAtLeastOneSignal = true;

        const atC = <T extends { at: string }>(rows: T[]): T[] => rows.filter((r) => r.at === c);
        expect(
          stripProvenance({
            ok: true,
            value: {
              signals: atC(extendedResult.value.signals),
              evaluations: atC(extendedResult.value.evaluations),
              notes: [],
              provenance: extendedResult.value.provenance,
            },
          }),
        ).toEqual(
          stripProvenance({
            ok: true,
            value: {
              signals: atC(baseResult.value.signals),
              evaluations: atC(baseResult.value.evaluations),
              notes: [],
              provenance: baseResult.value.provenance,
            },
          }),
        );
      }),
    );
    expect(sawAtLeastOneSignal).toBe(true);
  });
});

describe("I1 Future-blind — runBacktest", () => {
  it("appending a candle and a corporate-action factor with asOf after the run's period.to close never changes the run", () => {
    fc.assert(
      fc.property(longBacktestFixtureArbitrary, (fixture) => {
        const lastSession = assertDefined(
          fixture.calendar.at(-1),
          "test setup: non-empty calendar",
        );
        const firstSession = assertDefined(fixture.calendar[0], "test setup: non-empty calendar");
        const view = (
          extraCandles: Candle[],
          extraFactors: CorporateActionFactor[],
        ): MarketView => ({
          calendar: fixture.calendar,
          candles: [...fixture.candles, ...extraCandles],
          corporateActions: extraFactors,
          optionSeries: [],
          optionPrices: [],
          quotes: [],
          macro: [
            {
              series: "cdi",
              date: firstSession.date,
              asOf: firstSession.open,
              annualRate: fixture.cdiAnnualRate,
            },
          ],
          dividendYields: [],
          impliedVolatilityIndex: [],
        });

        const baseResult = runBacktest({ view: view([], []), config: fixture.config });

        const futureCandle: Candle = {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2099-01-01",
          asOf: asOfPlusMs(lastSession.close, 1),
          open: decimalString("999.00"),
          high: decimalString("999.00"),
          low: decimalString("999.00"),
          close: decimalString("999.00"),
          tradedQuantity: 1,
        };
        const futureFactor: CorporateActionFactor = {
          ticker: "PETR4",
          exDate: firstSession.date,
          asOf: asOfPlusMs(lastSession.close, 1),
          factor: decimalString("0.5"),
        };
        const extendedResult = runBacktest({
          view: view([futureCandle], [futureFactor]),
          config: fixture.config,
        });

        expect(baseResult.ok).toBe(true);
        expect(extendedResult.ok).toBe(true);
        if (!baseResult.ok || !extendedResult.ok) return;
        if (baseResult.value.status !== "complete" || extendedResult.value.status !== "complete") {
          throw new Error("expected both runs to complete");
        }

        const stripTruncated = (run: typeof baseResult.value.run) => ({
          ...run,
          provenance: { ...run.provenance, truncated: [] },
        });
        expect(stripTruncated(extendedResult.value.run)).toEqual(
          stripTruncated(baseResult.value.run),
        );
      }),
      { numRuns: 8 },
    );
  }, 30_000);
});
