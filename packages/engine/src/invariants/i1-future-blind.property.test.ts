import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  Candle,
  CorporateActionFactor,
  IndicatorSeries,
  IndicatorsInput,
  Result,
} from "../api";
import { computeIndicators } from "../internal/indicators-computation";
import { assertDefined } from "../internal/invariant";
import { decimalString } from "../internal/test-support";
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

const futureCandle = (index: number, close: string): Candle => {
  const session = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
  return {
    ticker: "PETR4",
    timeframe: "D1",
    session,
    asOf: `${session}T21:00:00.000Z`,
    open: decimalString(close),
    high: decimalString(close),
    low: decimalString(close),
    close: decimalString(close),
    tradedQuantity: 1,
  };
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
          const truncationCandle = assertDefined(
            candles[Math.floor(candles.length / 2)],
            "test setup: missing truncation candle",
          );
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
          const extendedInput: IndicatorsInput = {
            ...baseInput,
            view: view(
              extraPrices.map((p, i) => futureCandle(i, p)),
              [futureFactor(0)],
            ),
          };
          expect(stripTruncated(computeIndicators(extendedInput))).toEqual(
            stripTruncated(computeIndicators(baseInput)),
          );
        },
      ),
    );
  });
});
