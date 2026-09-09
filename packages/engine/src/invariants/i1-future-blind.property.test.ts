import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  Candle,
  CorporateActionFactor,
  ImpliedVolatilityIndexPoint,
  IndicatorSeries,
  IndicatorsInput,
  Result,
} from "../api";
import { computeIndicators } from "../internal/indicators-computation";
import { assertDefined } from "../internal/invariant";
import { instantMs } from "../internal/instant";
import { decimalString } from "../test/support";
import { candlePriceArbitrary, candleSeriesArbitrary } from "./arbitraries";

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
