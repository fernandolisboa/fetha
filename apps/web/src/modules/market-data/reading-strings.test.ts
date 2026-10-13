import { assetReadingThresholds as th } from "@fetha/engine";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { marketDataStrings } from "./strings";

// The reading sentences spell out the engine's label boundaries (ADR-0059) in
// prose. This keeps the prose honest if a boundary ever moves.
function percent(share: string, decimalSeparator: string): string {
  return `${new Decimal(share).times(100).toString().replace(".", decimalSeparator)}%`;
}

describe.each([
  ["en", marketDataStrings.en.reading, "."],
  ["ptBR", marketDataStrings.ptBR.reading, ","],
] as const)("%s reading sentences", (_locale, reading, separator) => {
  it("name the moving-average lengths", () => {
    for (const sentence of Object.values(reading.trend.sentence)) {
      expect(sentence).toContain(String(th.smaShortLength));
      expect(sentence).toContain(String(th.smaLongLength));
    }
    expect(reading.trend.missing).toContain(String(th.smaLongLength));
  });

  it("name the RSI boundaries", () => {
    expect(reading.momentum.name).toContain(String(th.rsiLength));
    expect(reading.momentum.sentence.oversold("x")).toContain(th.rsiOversold);
    expect(reading.momentum.sentence.neutral("x")).toContain(th.rsiOversold);
    expect(reading.momentum.sentence.neutral("x")).toContain(th.rsiOverbought);
    expect(reading.momentum.sentence.overbought("x")).toContain(th.rsiOverbought);
  });

  it("name the ATR-share boundaries", () => {
    const calm = percent(th.atrShareCalm, separator);
    const wide = percent(th.atrShareWide, separator);
    expect(reading.range.name).toContain(String(th.atrLength));
    expect(reading.range.sentence.calm("x", "y")).toContain(calm);
    expect(reading.range.sentence.normal("x", "y")).toContain(calm);
    expect(reading.range.sentence.normal("x", "y")).toContain(wide);
    expect(reading.range.sentence.wide("x", "y")).toContain(wide);
  });

  it("name the IV-rank lookback", () => {
    expect(reading.impliedVolatility.noRank("x")).toContain(String(th.ivRankLookbackSessions));
  });
});
