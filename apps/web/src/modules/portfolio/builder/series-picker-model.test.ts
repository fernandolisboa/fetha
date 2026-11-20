import { describe, expect, it } from "vitest";

import {
  defaultExpiry,
  distanceToSpot,
  expiryOptions,
  moneyness,
  pickerRows,
  type SeriesFilters,
} from "./series-picker-model";
import type { ChainSeries } from "./types";

function series(overrides: Partial<ChainSeries>): ChainSeries {
  return {
    ticker: "PETRA100",
    right: "call",
    strike: "10.00000000",
    expiry: "2099-01-16",
    style: "european",
    lastPrice: null,
    lastPriceStrike: null,
    ...overrides,
  };
}

const traded = { value: "0.50", session: "2099-01-05", trades: 12 };

const noFilters: SeriesFilters = {
  query: "",
  expiry: null,
  minStrike: "",
  maxStrike: "",
  includeUntraded: true,
};

describe("expiryOptions", () => {
  it("counts traded and listed series per cycle, nearest cycle first", () => {
    const chain = [
      series({ ticker: "B1", expiry: "2099-02-20", lastPrice: traded }),
      series({ ticker: "A1", expiry: "2099-01-16" }),
      series({ ticker: "A2", expiry: "2099-01-16", lastPrice: traded }),
    ];
    expect(expiryOptions(chain)).toEqual([
      { expiry: "2099-01-16", traded: 1, total: 2 },
      { expiry: "2099-02-20", traded: 1, total: 1 },
    ]);
  });
});

describe("defaultExpiry", () => {
  it("skips a nearer cycle with no trade at all", () => {
    const chain = [
      series({ ticker: "A1", expiry: "2099-01-16" }),
      series({ ticker: "B1", expiry: "2099-02-20", lastPrice: traded }),
    ];
    expect(defaultExpiry(chain)).toBe("2099-02-20");
  });

  it("falls back to the nearest cycle when nothing traded", () => {
    const chain = [
      series({ ticker: "B1", expiry: "2099-02-20" }),
      series({ ticker: "A1", expiry: "2099-01-16" }),
    ];
    expect(defaultExpiry(chain)).toBe("2099-01-16");
  });

  it("is null for an empty chain", () => {
    expect(defaultExpiry([])).toBeNull();
  });
});

describe("distanceToSpot", () => {
  it("is strike over spot minus one", () => {
    expect(distanceToSpot("11.00000000", "10.00")).toBe("0.100000");
    expect(distanceToSpot("9.00000000", "10.00")).toBe("-0.100000");
  });

  it("is null without a positive spot", () => {
    expect(distanceToSpot("9.00000000", "0")).toBeNull();
  });
});

describe("moneyness", () => {
  it("reads a call above the spot as out of the money and below as in", () => {
    expect(moneyness("call", "0.050000")).toBe("out");
    expect(moneyness("call", "-0.050000")).toBe("in");
  });

  it("reads a put the other way round", () => {
    expect(moneyness("put", "0.050000")).toBe("in");
    expect(moneyness("put", "-0.050000")).toBe("out");
  });

  it("calls a strike within 1% of the spot at the money", () => {
    expect(moneyness("call", "0.009940")).toBe("at");
    expect(moneyness("put", "-0.009940")).toBe("at");
    expect(moneyness("call", "0.010000")).toBe("out");
  });

  it("decides on the distance as displayed, two decimals of a percent", () => {
    expect(moneyness("call", "0.009990")).toBe("out");
    expect(moneyness("call", "0.009949")).toBe("at");
  });

  it("is null without a distance", () => {
    expect(moneyness("call", null)).toBeNull();
  });
});

describe("pickerRows", () => {
  const chain = [
    series({ ticker: "PETRA90", strike: "9.00000000", lastPrice: traded }),
    series({ ticker: "PETRA95", strike: "9.50000000" }),
    series({ ticker: "PETRA100", strike: "10.00000000", lastPrice: traded }),
    series({ ticker: "PETRA110", strike: "11.00000000", lastPrice: traded }),
    series({ ticker: "PETRB100", strike: "10.00000000", expiry: "2099-02-20", lastPrice: traded }),
  ];

  function tickers(filters: Partial<SeriesFilters>, spot: string | null = null): string[] {
    return pickerRows(chain, { ...noFilters, ...filters }, spot).map((row) => row.series.ticker);
  }

  it("puts priceable series first within each cycle, keeping the strike ladder", () => {
    expect(tickers({})).toEqual(["PETRA90", "PETRA100", "PETRA110", "PETRA95", "PETRB100"]);
  });

  it("hides untraded series unless asked", () => {
    expect(tickers({ includeUntraded: false })).not.toContain("PETRA95");
  });

  it("keeps one cycle", () => {
    expect(tickers({ expiry: "2099-02-20" })).toEqual(["PETRB100"]);
  });

  it("bounds strikes inclusively, in pt-BR decimals", () => {
    expect(tickers({ minStrike: "9,5", maxStrike: "10" })).toEqual([
      "PETRA100",
      "PETRA95",
      "PETRB100",
    ]);
  });

  it("ignores a strike bound that does not parse", () => {
    expect(tickers({ minStrike: "abc" })).toHaveLength(chain.length);
  });

  it("matches the query against the ticker, case-insensitively", () => {
    expect(tickers({ query: "petrb" })).toEqual(["PETRB100"]);
  });

  it("matches the query against the strike as shown, with comma or dot", () => {
    expect(tickers({ query: "9,5" })).toEqual(["PETRA95"]);
    expect(tickers({ query: "9.5" })).toEqual(["PETRA95"]);
  });

  it("finds a strike of a thousand or more typed with or without grouping", () => {
    const index = [series({ ticker: "IBOVL130", strike: "130000.00000000" })];
    const found = (query: string) =>
      pickerRows(index, { ...noFilters, query }, null).map((row) => row.series.ticker);
    expect(found("130000")).toEqual(["IBOVL130"]);
    expect(found("130.000")).toEqual(["IBOVL130"]);
    expect(found("130.000,00")).toEqual(["IBOVL130"]);
    expect(found("131")).toEqual([]);
  });

  it("annotates each row with its distance and moneyness against the spot", () => {
    const rows = pickerRows(chain, { ...noFilters, expiry: "2099-01-16" }, "10.00");
    const byTicker = new Map(rows.map((row) => [row.series.ticker, row]));
    expect(byTicker.get("PETRA90")).toMatchObject({ distance: "-0.100000", moneyness: "in" });
    expect(byTicker.get("PETRA100")).toMatchObject({ distance: "0.000000", moneyness: "at" });
    expect(byTicker.get("PETRA110")).toMatchObject({ distance: "0.100000", moneyness: "out" });
  });

  it("leaves distance and moneyness empty without a spot", () => {
    const [row] = pickerRows(chain, noFilters, null);
    expect(row).toMatchObject({ distance: null, moneyness: null });
  });
});
