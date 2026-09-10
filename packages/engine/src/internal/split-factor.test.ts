import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { CorporateActionFactor } from "../api";
import { decimalString } from "../test/support";
import { splitFactorProduct } from "./split-factor";

function factor(exDate: string, value: string): CorporateActionFactor {
  return { ticker: "PETR4", exDate, asOf: `${exDate}T13:00:00.000Z`, factor: decimalString(value) };
}

describe("splitFactorProduct", () => {
  it("returns 1 when no factor falls in (openedAt, through]", () => {
    const result = splitFactorProduct([], "2024-01-01", "2024-01-10");
    expect(result).toEqual({ ok: true, value: new Decimal(1) });
  });

  it("multiplies every factor with exDate strictly after openedAt and at or before through", () => {
    const factors = [
      factor("2024-01-01", "0.5"),
      factor("2024-01-05", "0.5"),
      factor("2024-02-01", "0.5"),
    ];
    const result = splitFactorProduct(factors, "2024-01-01", "2024-01-10");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toNumber()).toBeCloseTo(0.5);
  });

  it("returns invalid_input for a non-positive factor (item 8)", () => {
    const factors = [factor("2024-01-05", "0")];
    const result = splitFactorProduct(factors, "2024-01-01", "2024-01-10");
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        path: "corporateActions[].factor",
        message: "a corporate-action factor must be positive",
      },
    });
  });

  it("returns invalid_input for a negative factor (item 8)", () => {
    const factors = [factor("2024-01-05", "-1.00")];
    const result = splitFactorProduct(factors, "2024-01-01", "2024-01-10");
    expect(result.ok).toBe(false);
  });

  it("ignores a non-positive factor outside the (openedAt, through] window", () => {
    const factors = [factor("2024-02-01", "0")];
    const result = splitFactorProduct(factors, "2024-01-01", "2024-01-10");
    expect(result).toEqual({ ok: true, value: new Decimal(1) });
  });
});
