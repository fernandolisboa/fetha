import { tickerSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { instrumentLabel } from "./instrument-label";
import type { PlanLegSeries } from "./actions";

function series(overrides: Partial<PlanLegSeries> = {}): PlanLegSeries {
  return {
    underlying: tickerSchema.parse("PETR4"),
    right: "call",
    strike: "36.000000" as never,
    expiry: "2027-01-16",
    ...overrides,
  };
}

describe("instrumentLabel", () => {
  it("names the underlying, not the option's own series ticker", () => {
    const label = instrumentLabel(
      { role: "call", ticker: "PETRL44" },
      series({ right: "call", strike: "36.000000" as never }),
    );
    expect(label).toBe("Call de PETR4, strike R$ 36,00, vence 16/01/2027");
    expect(label).not.toContain("PETRL44");
  });

  it("names a put the same way", () => {
    const label = instrumentLabel(
      { role: "put", ticker: "PETRM32" },
      series({ right: "put", strike: "32.000000" as never }),
    );
    expect(label).toBe("Put de PETR4, strike R$ 32,00, vence 16/01/2027");
  });

  it("names a stock leg by its own ticker, never the series' underlying", () => {
    const label = instrumentLabel({ role: "stock", ticker: "PETR4" }, undefined);
    expect(label).toBe("Ações de PETR4");
  });

  it("falls back to the stock label when no series was resolved for an option leg", () => {
    const label = instrumentLabel({ role: "call", ticker: "PETRL44" }, undefined);
    expect(label).toBe("Ações de PETRL44");
  });
});
