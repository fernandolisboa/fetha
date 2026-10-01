import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { CorporateActionFactor } from "../api";
import { decimalString } from "../test/support";
import { rescaleStalePrice, splitFactorProduct } from "./split-factor";

// Mirrored by value in apps/web/src/modules/portfolio/corporate-action-basis.split-factor-
// pin.test.ts, which runs the portfolio edge's own `splitFactorProduct` copy against the
// identical cases: the engine's interface is frozen (ADR-0013) and this helper is not exported,
// so apps/web keeps its own copy (CLAUDE.md "never depend on engine internals from outside the
// package"). Keeping both expectation tables byte-identical means either copy's behavior drifting
// from the other fails that side's own test, not just review.
const SHARED_SPLIT_FACTOR_FIXTURE_CASES: {
  name: string;
  factors: { exDate: string; factor: string }[];
  openedAt: string;
  through: string;
  expected: { ok: true; value: string } | { ok: false };
}[] = [
  {
    name: "no factor in (openedAt, through]",
    factors: [],
    openedAt: "2024-01-01",
    through: "2024-01-10",
    expected: { ok: true, value: "1" },
  },
  {
    name: "a single 2-for-1 split ex-dated inside the window",
    factors: [{ exDate: "2024-01-05", factor: "0.5" }],
    openedAt: "2024-01-01",
    through: "2024-01-10",
    expected: { ok: true, value: "0.5" },
  },
  {
    name: "two factors inside the window multiply; one outside the window and one at openedAt are ignored",
    factors: [
      { exDate: "2024-01-01", factor: "0.5" },
      { exDate: "2024-01-05", factor: "0.5" },
      { exDate: "2024-01-08", factor: "0.5" },
      { exDate: "2024-02-01", factor: "0.5" },
    ],
    openedAt: "2024-01-01",
    through: "2024-01-10",
    expected: { ok: true, value: "0.25" },
  },
  {
    name: "a factor exactly at openedAt is excluded (window is exclusive of openedAt)",
    factors: [{ exDate: "2024-01-01", factor: "0.5" }],
    openedAt: "2024-01-01",
    through: "2024-01-10",
    expected: { ok: true, value: "1" },
  },
  {
    name: "a factor exactly at through is included (window is inclusive of through)",
    factors: [{ exDate: "2024-01-10", factor: "2" }],
    openedAt: "2024-01-01",
    through: "2024-01-10",
    expected: { ok: true, value: "2" },
  },
  {
    name: "a non-positive factor inside the window is refused",
    factors: [{ exDate: "2024-01-05", factor: "0" }],
    openedAt: "2024-01-01",
    through: "2024-01-10",
    expected: { ok: false },
  },
  {
    name: "a negative factor inside the window is refused",
    factors: [{ exDate: "2024-01-05", factor: "-1" }],
    openedAt: "2024-01-01",
    through: "2024-01-10",
    expected: { ok: false },
  },
  {
    name: "a non-positive factor outside the window is ignored",
    factors: [{ exDate: "2024-02-01", factor: "0" }],
    openedAt: "2024-01-01",
    through: "2024-01-10",
    expected: { ok: true, value: "1" },
  },
];

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

  it("returns invalid_input for a non-positive factor", () => {
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

  it("returns invalid_input for a negative factor", () => {
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

describe("splitFactorProduct against the shared fixture pinned with apps/web's own copy", () => {
  for (const testCase of SHARED_SPLIT_FACTOR_FIXTURE_CASES) {
    it(testCase.name, () => {
      const result = splitFactorProduct(
        testCase.factors.map((f) => factor(f.exDate, f.factor)),
        testCase.openedAt,
        testCase.through,
      );
      if (testCase.expected.ok) {
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.toString()).toBe(new Decimal(testCase.expected.value).toString());
        }
      } else {
        expect(result.ok).toBe(false);
      }
    });
  }
});

describe("rescaleStalePrice (#279)", () => {
  const factor = (exDate: string, value: string): CorporateActionFactor => ({
    ticker: "PETR4",
    exDate,
    asOf: `${exDate}T13:00:00.000Z`,
    factor: decimalString(value),
  });

  it("leaves a fresh price untouched", () => {
    const result = rescaleStalePrice(
      [factor("2024-01-05", "0.5")],
      new Decimal(20),
      null,
      "2024-01-10",
    );
    expect(result).toEqual({ ok: true, value: { price: new Decimal(20), rescaled: false } });
  });

  it("rescales a stale price by the factors over (stale session, through]", () => {
    const result = rescaleStalePrice(
      [factor("2024-01-03", "0.5"), factor("2024-01-05", "0.5"), factor("2024-01-12", "0.5")],
      new Decimal(20),
      "2024-01-03",
      "2024-01-10",
    );
    expect(result.ok && result.value.price.toString()).toBe("10");
    expect(result.ok && result.value.rescaled).toBe(true);
  });

  it("reports no rescale when no factor falls inside the window", () => {
    const result = rescaleStalePrice(
      [factor("2024-01-12", "0.5")],
      new Decimal(20),
      "2024-01-03",
      "2024-01-10",
    );
    expect(result.ok && result.value.rescaled).toBe(false);
  });

  it("refuses a non-positive factor inside the window", () => {
    const result = rescaleStalePrice(
      [factor("2024-01-05", "0")],
      new Decimal(20),
      "2024-01-03",
      "2024-01-10",
    );
    expect(result.ok).toBe(false);
  });
});
