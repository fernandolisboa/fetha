import { describe, expect, it } from "vitest";
import { decimalStringSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";
import type { OptionSeries } from "@fetha/engine";

import { selectNextMonthlySeries } from "./roll-series-selection";

function series(partial: Partial<OptionSeries>): OptionSeries {
  return {
    ticker: tickerSchema.parse("PETR4F300"),
    underlying: tickerSchema.parse("PETR4"),
    right: "call",
    strike: decimalStringSchema.parse("30.000000"),
    expiry: sessionDateSchema.parse("2026-12-18"),
    style: "european",
    asOf: "2026-11-19T18:00:00.000Z",
    ...partial,
  };
}

describe("selectNextMonthlySeries", () => {
  const target = {
    underlying: tickerSchema.parse("PETR4"),
    right: "call" as const,
    currentExpiry: sessionDateSchema.parse("2026-11-20"),
    currentStrike: decimalStringSchema.parse("30.000000"),
  };

  it("picks the nearest strike at the next expiry after the held leg's own expiry", () => {
    const result = selectNextMonthlySeries(
      [
        series({ ticker: tickerSchema.parse("PETR4F300"), expiry: target.currentExpiry }),
        series({
          ticker: tickerSchema.parse("PETR4G280"),
          strike: decimalStringSchema.parse("28.000000"),
          expiry: sessionDateSchema.parse("2026-12-18"),
        }),
        series({
          ticker: tickerSchema.parse("PETR4G320"),
          strike: decimalStringSchema.parse("32.000000"),
          expiry: sessionDateSchema.parse("2026-12-18"),
        }),
        series({
          ticker: tickerSchema.parse("PETR4G300"),
          strike: decimalStringSchema.parse("30.500000"),
          expiry: sessionDateSchema.parse("2026-12-18"),
        }),
      ],
      target,
    );

    if (!result.ok) throw new Error("expected a selection");
    expect(result.series.ticker).toBe("PETR4G300");
  });

  it("ignores expiries at or before the held leg's own expiry", () => {
    const result = selectNextMonthlySeries(
      [series({ ticker: tickerSchema.parse("PETR4F300"), expiry: target.currentExpiry })],
      target,
    );

    expect(result).toEqual({ ok: false, reason: "no_next_expiry" });
  });

  it("ignores series of the wrong right or underlying", () => {
    const result = selectNextMonthlySeries(
      [
        series({
          ticker: tickerSchema.parse("PETR4G300"),
          right: "put",
          expiry: sessionDateSchema.parse("2026-12-18"),
        }),
        series({
          ticker: tickerSchema.parse("VALE3G300"),
          underlying: tickerSchema.parse("VALE3"),
          expiry: sessionDateSchema.parse("2026-12-18"),
        }),
      ],
      target,
    );

    expect(result).toEqual({ ok: false, reason: "no_next_expiry" });
  });

  it("breaks a tie between two equally close strikes toward the lower one", () => {
    const result = selectNextMonthlySeries(
      [
        series({ ticker: tickerSchema.parse("PETR4F300"), expiry: target.currentExpiry }),
        series({
          ticker: tickerSchema.parse("PETR4G280"),
          strike: decimalStringSchema.parse("29.000000"),
          expiry: sessionDateSchema.parse("2026-12-18"),
        }),
        series({
          ticker: tickerSchema.parse("PETR4G320"),
          strike: decimalStringSchema.parse("31.000000"),
          expiry: sessionDateSchema.parse("2026-12-18"),
        }),
      ],
      target,
    );

    if (!result.ok) throw new Error("expected a selection");
    expect(result.series.ticker).toBe("PETR4G280");
  });

  it("refuses when the next expiry has no series at all for this right", () => {
    const result = selectNextMonthlySeries(
      [
        series({ ticker: tickerSchema.parse("PETR4F300"), expiry: target.currentExpiry }),
        series({
          ticker: tickerSchema.parse("PETR4G300"),
          right: "put",
          expiry: sessionDateSchema.parse("2026-12-18"),
        }),
      ],
      target,
    );

    expect(result).toEqual({ ok: false, reason: "no_next_expiry" });
  });

  it("is a pure function of its inputs: calling it twice with the same arguments agrees", () => {
    const list: OptionSeries[] = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: target.currentExpiry }),
      series({
        ticker: tickerSchema.parse("PETR4G300"),
        strike: decimalStringSchema.parse("30.000000"),
        expiry: sessionDateSchema.parse("2026-12-18"),
      }),
    ];
    expect(selectNextMonthlySeries(list, target)).toEqual(selectNextMonthlySeries(list, target));
  });
});
