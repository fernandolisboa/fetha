import { describe, expect, it } from "vitest";
import { decimalStringSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";
import type { OptionSeries } from "@fetha/engine";

import { selectNearestStrikeAtExpiry, selectNextMonthlyExpiry } from "./roll-series-selection";

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

const underlying = tickerSchema.parse("PETR4");
const currentExpiry = sessionDateSchema.parse("2026-11-20");
const nextExpiry = sessionDateSchema.parse("2026-12-18");

describe("selectNextMonthlyExpiry", () => {
  it("picks the earliest monthly expiry later than the held leg's own expiry", () => {
    const result = selectNextMonthlyExpiry(
      [
        series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
        series({ ticker: tickerSchema.parse("PETR4G300"), expiry: nextExpiry }),
        series({
          ticker: tickerSchema.parse("PETR4H300"),
          expiry: sessionDateSchema.parse("2027-01-15"),
        }),
      ],
      { underlying, currentExpiry },
    );

    expect(result).toEqual({ ok: true, expiry: nextExpiry });
  });

  it("ignores expiries at or before the held leg's own expiry", () => {
    const result = selectNextMonthlyExpiry(
      [series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry })],
      { underlying, currentExpiry },
    );

    expect(result).toEqual({ ok: false, reason: "no_next_expiry" });
  });

  it("ignores series of another underlying", () => {
    const result = selectNextMonthlyExpiry(
      [
        series({
          ticker: tickerSchema.parse("VALE3G300"),
          underlying: tickerSchema.parse("VALE3"),
          expiry: nextExpiry,
        }),
      ],
      { underlying, currentExpiry },
    );

    expect(result).toEqual({ ok: false, reason: "no_next_expiry" });
  });

  it("picks the next expiry even when no series there has traded yet", () => {
    // Regression for #382: a chain narrowed to traded series before the next
    // expiry is chosen would skip this expiry entirely and jump past it.
    const result = selectNextMonthlyExpiry(
      [
        series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
        series({ ticker: tickerSchema.parse("PETR4G300"), expiry: nextExpiry }),
      ],
      { underlying, currentExpiry },
    );

    expect(result).toEqual({ ok: true, expiry: nextExpiry });
  });

  it("is a pure function of its inputs: calling it twice with the same arguments agrees", () => {
    const list: OptionSeries[] = [
      series({ ticker: tickerSchema.parse("PETR4F300"), expiry: currentExpiry }),
      series({ ticker: tickerSchema.parse("PETR4G300"), expiry: nextExpiry }),
    ];
    expect(selectNextMonthlyExpiry(list, { underlying, currentExpiry })).toEqual(
      selectNextMonthlyExpiry(list, { underlying, currentExpiry }),
    );
  });
});

describe("selectNearestStrikeAtExpiry", () => {
  const target = {
    underlying,
    right: "call" as const,
    expiry: nextExpiry,
    currentStrike: decimalStringSchema.parse("30.000000"),
  };

  it("picks the nearest strike at the given expiry", () => {
    const result = selectNearestStrikeAtExpiry(
      [
        series({
          ticker: tickerSchema.parse("PETR4G280"),
          strike: decimalStringSchema.parse("28.000000"),
          expiry: nextExpiry,
        }),
        series({
          ticker: tickerSchema.parse("PETR4G320"),
          strike: decimalStringSchema.parse("32.000000"),
          expiry: nextExpiry,
        }),
        series({
          ticker: tickerSchema.parse("PETR4G300"),
          strike: decimalStringSchema.parse("30.500000"),
          expiry: nextExpiry,
        }),
      ],
      target,
    );

    if (!result.ok) throw new Error("expected a selection");
    expect(result.series.ticker).toBe("PETR4G300");
  });

  it("ignores series of the wrong right, underlying or expiry", () => {
    const result = selectNearestStrikeAtExpiry(
      [
        series({ ticker: tickerSchema.parse("PETR4G300"), right: "put", expiry: nextExpiry }),
        series({
          ticker: tickerSchema.parse("VALE3G300"),
          underlying: tickerSchema.parse("VALE3"),
          expiry: nextExpiry,
        }),
        series({
          ticker: tickerSchema.parse("PETR4F300"),
          expiry: currentExpiry,
        }),
      ],
      target,
    );

    expect(result).toEqual({ ok: false, reason: "no_traded_series" });
  });

  it("breaks a tie between two equally close strikes toward the lower one", () => {
    const result = selectNearestStrikeAtExpiry(
      [
        series({
          ticker: tickerSchema.parse("PETR4G280"),
          strike: decimalStringSchema.parse("29.000000"),
          expiry: nextExpiry,
        }),
        series({
          ticker: tickerSchema.parse("PETR4G320"),
          strike: decimalStringSchema.parse("31.000000"),
          expiry: nextExpiry,
        }),
      ],
      target,
    );

    if (!result.ok) throw new Error("expected a selection");
    expect(result.series.ticker).toBe("PETR4G280");
  });

  it("refuses when no series at that expiry matches", () => {
    const result = selectNearestStrikeAtExpiry(
      [series({ ticker: tickerSchema.parse("PETR4G300"), right: "put", expiry: nextExpiry })],
      target,
    );

    expect(result).toEqual({ ok: false, reason: "no_traded_series" });
  });

  it("is a pure function of its inputs: calling it twice with the same arguments agrees", () => {
    const list: OptionSeries[] = [
      series({ ticker: tickerSchema.parse("PETR4G300"), expiry: nextExpiry }),
    ];
    expect(selectNearestStrikeAtExpiry(list, target)).toEqual(
      selectNearestStrikeAtExpiry(list, target),
    );
  });
});
