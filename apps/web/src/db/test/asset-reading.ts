import { assetReadingThresholds, type AssetReading } from "@fetha/engine";
import { decimalStringSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";

// A complete asset reading for tests that store one (a research idea validates it on write and
// read, docs/adr/0076).
export function assetReadingFixture(ticker: string, session = "2026-10-23"): AssetReading {
  const date = sessionDateSchema.parse(session);
  return {
    ticker: tickerSchema.parse(ticker),
    session: date,
    close: decimalStringSchema.parse("38.50"),
    trend: { label: "up", smaShort: decimalStringSchema.parse("37"), smaLong: null },
    momentum: { label: "neutral", rsi: decimalStringSchema.parse("55") },
    range: { label: "calm", atr: null, atrShare: null },
    impliedVolatility: { label: "low", ivRank: decimalStringSchema.parse("20"), latest: null },
    options: { label: "liquid", session: date, tradedSeries: 30, nextExpiries: [] },
    thresholds: assetReadingThresholds,
    notes: [],
    provenance: {
      engineVersion: "test",
      pricingModel: "bsm_continuous_yield",
      truncated: [],
      dataVersion: null,
      datasetNotes: [],
    },
  };
}
