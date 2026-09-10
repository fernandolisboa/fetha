import { describe, expect, it } from "vitest";
import { decimalString } from "../test/support";
import { resolveDividendYield, resolveRiskFreeRate } from "./rates";

const at = "2024-01-02T21:00:00.000Z";

describe("resolveRiskFreeRate", () => {
  it("defaults to zero with risk_free_rate_defaulted when no cdi point is visible", () => {
    const result = resolveRiskFreeRate([], at);
    expect(result).toEqual({
      ok: true,
      value: decimalString("0.000000"),
      notes: [{ code: "risk_free_rate_defaulted", message: "no cdi rate visible; defaulted to 0" }],
    });
  });

  it("converts the visible cdi annual rate to a continuous rate with no notes", () => {
    const result = resolveRiskFreeRate(
      [{ series: "cdi", date: "2024-01-01", asOf: at, annualRate: decimalString("0.105709") }],
      at,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes).toEqual([]);
    expect(Number(result.value)).toBeGreaterThan(0);
  });

  it("returns invalid_input when the visible cdi annual rate is at or below -1", () => {
    const result = resolveRiskFreeRate(
      [{ series: "cdi", date: "2024-01-01", asOf: at, annualRate: decimalString("-1.00") }],
      at,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "macro.cdi.annualRate",
      message: "annual rate must be greater than -1",
    });
  });
});

describe("resolveDividendYield", () => {
  it("defaults to zero with dividend_yield_defaulted when no point is visible", () => {
    const result = resolveDividendYield([], "PETR4", at);
    expect(result).toEqual({
      ok: true,
      value: decimalString("0.000000"),
      notes: [
        { code: "dividend_yield_defaulted", message: "no dividend yield visible; defaulted to 0" },
      ],
    });
  });

  it("returns invalid_input when the visible annual yield is at or below -1", () => {
    const result = resolveDividendYield(
      [{ underlying: "PETR4", asOf: at, annualYield: decimalString("-1.50") }],
      "PETR4",
      at,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "dividendYields.annualYield",
      message: "annual rate must be greater than -1",
    });
  });
});
