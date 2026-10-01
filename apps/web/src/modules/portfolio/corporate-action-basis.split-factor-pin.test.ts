import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { DecimalString } from "@fetha/contracts";
import type { CorporateActionFactor } from "@fetha/engine";

import { splitFactorProduct } from "./corporate-action-basis";

// Mirrored by value in packages/engine/src/internal/split-factor.test.ts, which runs the
// engine's own `splitFactorProduct` against the identical cases (see that file's comment for
// why this is a value-mirror, not a shared import: the engine may not import `@fetha/contracts`
// at runtime, even in a test, ADR-0013). Keeping both expectation tables byte-identical means
// either copy's behavior drifting from the other fails that side's own test.
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
  return {
    ticker: "PETR4",
    exDate,
    asOf: `${exDate}T13:00:00.000Z` as never,
    factor: value as DecimalString,
  };
}

describe("splitFactorProduct against the shared fixture pinned with the engine's own copy", () => {
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
