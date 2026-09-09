import { describe, expect, it } from "vitest";

import { detectFatcotFactorChanges } from "./detect-factor-changes";
import type { CotahistOptionRow } from "./schema";

function optionRow(overrides: Partial<CotahistOptionRow> = {}): CotahistOptionRow {
  return {
    kind: "option",
    session: "2026-09-08",
    ticker: "PETRW123",
    right: "call",
    strike: "27.00",
    expiry: "2026-10-16",
    factor: "1",
    open: "1.50",
    high: "1.80",
    low: "1.40",
    average: "1.60",
    close: "1.70",
    trades: 10,
    tradedQuantity: 100,
    ...overrides,
  };
}

describe("detectFatcotFactorChanges", () => {
  it("records a factor change when FATCOT differs from the previous session", () => {
    const previous = new Map([["PETRW123", "1"]]);
    const asOf = new Date("2026-09-08T20:00:00.000Z");
    const changes = detectFatcotFactorChanges(previous, "2026-09-08", asOf, [
      optionRow({ factor: "1000" }),
    ]);

    expect(changes).toEqual([{ ticker: "PETRW123", exDate: "2026-09-08", asOf, factor: "1000" }]);
  });

  it("does not record anything when the factor is unchanged", () => {
    const previous = new Map([["PETRW123", "1"]]);
    const changes = detectFatcotFactorChanges(previous, "2026-09-08", new Date(), [
      optionRow({ factor: "1" }),
    ]);
    expect(changes).toEqual([]);
  });

  it("does not record anything for a ticker with no previous factor", () => {
    const changes = detectFatcotFactorChanges(new Map(), "2026-09-08", new Date(), [
      optionRow({ factor: "1000" }),
    ]);
    expect(changes).toEqual([]);
  });
});
