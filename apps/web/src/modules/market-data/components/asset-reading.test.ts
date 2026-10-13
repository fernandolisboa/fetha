import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assetReadingThresholds, type AssetReading } from "@fetha/engine";
import type { DecimalString } from "@fetha/contracts";

import { AssetReadingPanel } from "./asset-reading";

function reading(overrides: Partial<AssetReading> = {}): AssetReading {
  return {
    ticker: "IBOV11",
    session: "2026-10-09",
    close: "187366.840000" as DecimalString,
    trend: {
      label: "up",
      smaShort: "185000.000000" as DecimalString,
      smaLong: "180000.000000" as DecimalString,
    },
    momentum: { label: "neutral", rsi: "55.000000" as DecimalString },
    range: {
      label: "calm",
      atr: "1200.000000" as DecimalString,
      atrShare: "0.010000" as DecimalString,
    },
    impliedVolatility: { label: null, ivRank: null, latest: null },
    options: { label: "none", session: null, tradedSeries: 0, nextExpiries: [] },
    thresholds: assetReadingThresholds,
    notes: [],
    provenance: {
      engineVersion: "test",
      pricingModel: "bsm_continuous_yield",
      truncated: [],
      dataVersion: null,
      datasetNotes: [],
    },
    ...overrides,
  };
}

function renderPanel(props: Parameters<typeof AssetReadingPanel>[0]): string {
  return renderToStaticMarkup(createElement(AssetReadingPanel, props));
}

describe("AssetReadingPanel", () => {
  it("formats trend levels with R$ and shows the range/ATR row for an ordinary instrument", () => {
    const html = renderPanel({ reading: reading() });
    expect(html).toContain("R$");
  });

  it("ADR-0062: never prints R$ for a market index, and drops the range/ATR row", () => {
    const html = renderPanel({ reading: reading(), isIndex: true });
    expect(html).not.toContain("R$");
    // SMA levels still show, in points.
    expect(html).toContain("185.000,00");
    expect(html).toContain("180.000,00");
  });

  it("renders nothing useful without a reading, index or not", () => {
    expect(renderPanel({ reading: null })).not.toContain("R$");
    expect(renderPanel({ reading: null, isIndex: true })).not.toContain("R$");
  });
});
