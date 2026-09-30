import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { IndicatorSpec } from "@fetha/contracts";
import type {
  Candle,
  EvaluateStrategyInput,
  Evaluation,
  IndicatorSeries,
  MarketView,
  Result,
  StrategyVersion,
} from "../api";
import { evaluateStrategy } from "../internal/evaluate-strategy";
import { computeIndicators } from "../internal/indicators-computation";
import { instantMs } from "../internal/instant";
import { assertDefined } from "../internal/invariant";
import { centavos, decimalString } from "../test/support";
import { restatedCandleSeriesArbitrary } from "./arbitraries";

// I1, I3 and catch-up equivalence over views holding restated daily candles (#38, ADR-0055); the
// shared suites draw one version per session only.

const riskProfile = {
  declaredCapital: centavos(1_000_000_00),
  limits: {
    maxLossPerOperation: decimalString("1"),
    maxExposurePerOperation: decimalString("1"),
    maxOpenOperations: 100,
    maxPremiumBought: decimalString("1"),
  },
};

const emptyView: MarketView = {
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

const strategyOver = (indicator: IndicatorSpec): StrategyVersion => ({
  id: "v1",
  definition: {
    name: "test",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator },
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
});

const indicatorArbitrary = fc.constantFrom<IndicatorSpec>(
  { kind: "sma", length: 3 },
  { kind: "ema", length: 2 },
);

const shuffle = <T>(rows: readonly T[], seed: number): T[] => {
  const copy = [...rows];
  let s = seed;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const a = assertDefined(copy[i], "shuffle: index");
    copy[i] = assertDefined(copy[j], "shuffle: index");
    copy[j] = a;
  }
  return copy;
};

const withoutTruncated = <T extends Evaluation | IndicatorSeries>(result: Result<T>): unknown => {
  if (!result.ok) return result;
  const { provenance } = result.value;
  return {
    ...result.value,
    provenance: {
      engineVersion: provenance.engineVersion,
      pricingModel: provenance.pricingModel,
      dataVersion: provenance.dataVersion,
      datasetNotes: provenance.datasetNotes,
    },
  };
};

const byAsOf = (candles: readonly Candle[]): Candle[] =>
  [...candles].sort((a, b) => instantMs(a.asOf) - instantMs(b.asOf));

const firstVersions = (candles: readonly Candle[]): Candle[] => {
  const bySession = new Map<string, Candle>();
  for (const c of byAsOf(candles)) if (!bySession.has(c.session)) bySession.set(c.session, c);
  return [...bySession.values()];
};

const evaluate = (
  candles: Candle[],
  strategy: StrategyVersion,
  at: string,
  since?: string,
): Result<Evaluation> =>
  evaluateStrategy({
    view: { ...emptyView, candles },
    strategy,
    instruments: ["PETR4"],
    at,
    riskProfile,
    ...(since === undefined ? {} : { since }),
  } satisfies EvaluateStrategyInput);

describe("restated daily candles (#38)", () => {
  it("a catch-up equals one call at each session's first publication", () => {
    fc.assert(
      fc.property(restatedCandleSeriesArbitrary, indicatorArbitrary, (candles, indicator) => {
        const strategy = strategyOver(indicator);
        const latest = assertDefined(byAsOf(candles).at(-1), "test setup: latest row").asOf;
        const singles = firstVersions(candles).map((first) => {
          const result = evaluate(candles, strategy, first.asOf);
          if (!result.ok) throw new Error("test setup: unexpected engine error");
          return result.value;
        });
        const since = `${assertDefined(candles[0], "test setup: first row").session}T00:00:00.000Z`;
        const catchUp = evaluate(candles, strategy, latest, since);
        if (!catchUp.ok) throw new Error("test setup: unexpected engine error");
        expect(catchUp.value.evaluations).toEqual(singles.flatMap((r) => r.evaluations));
        expect(catchUp.value.signals).toEqual(singles.flatMap((r) => r.signals));
      }),
    );
  });

  it("I3: any permutation of the candles yields a deep-equal artifact", () => {
    fc.assert(
      fc.property(
        restatedCandleSeriesArbitrary,
        indicatorArbitrary,
        fc.nat(),
        fc.integer({ min: 0, max: 1_000_000 }),
        (candles, indicator, atIndex, seed) => {
          const strategy = strategyOver(indicator);
          const instants = byAsOf(candles).map((c) => c.asOf);
          const at = assertDefined(instants[atIndex % instants.length], "test setup: at");
          const since = assertDefined(instants[0], "test setup: since");
          const shuffled = shuffle(candles, seed);
          expect(evaluate(candles, strategy, at).ok).toBe(true);
          expect(evaluate(shuffled, strategy, at)).toEqual(evaluate(candles, strategy, at));
          if (at !== since) {
            expect(evaluate(shuffled, strategy, at, since)).toEqual(
              evaluate(candles, strategy, at, since),
            );
          }
          const indicators = (rows: Candle[]) =>
            computeIndicators({
              view: { ...emptyView, candles: rows },
              ticker: "PETR4",
              timeframe: "D1",
              indicators: [indicator],
              at,
            });
          expect(indicators(shuffled)).toEqual(indicators(candles));
        },
      ),
    );
  });

  it("I1: rows published after `at` never change the artifact at `at`", () => {
    fc.assert(
      fc.property(
        restatedCandleSeriesArbitrary,
        indicatorArbitrary,
        fc.nat(),
        (candles, indicator, atIndex) => {
          const strategy = strategyOver(indicator);
          const instants = byAsOf(candles).map((c) => c.asOf);
          const at = assertDefined(instants[atIndex % instants.length], "test setup: at");
          const visible = candles.filter((c) => instantMs(c.asOf) <= instantMs(at));
          expect(withoutTruncated(evaluate(candles, strategy, at))).toEqual(
            withoutTruncated(evaluate(visible, strategy, at)),
          );
          const since = `${assertDefined(candles[0], "test setup: first row").session}T00:00:00.000Z`;
          expect(withoutTruncated(evaluate(candles, strategy, at, since))).toEqual(
            withoutTruncated(evaluate(visible, strategy, at, since)),
          );
          const indicators = (rows: Candle[]) =>
            computeIndicators({
              view: { ...emptyView, candles: rows },
              ticker: "PETR4",
              timeframe: "D1",
              indicators: [indicator],
              at,
            });
          expect(withoutTruncated(indicators(candles))).toEqual(
            withoutTruncated(indicators(visible)),
          );
        },
      ),
    );
  });
});
