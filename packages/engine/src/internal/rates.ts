import Decimal from "decimal.js";
import type { Instant, Ticker } from "@fetha/contracts";
import type { DividendYieldPoint, MacroPoint, Note } from "../api";
import { parseDecimal, RATIO_SCALE, toDecimalString } from "./decimal";
import { latestVisible } from "./visible";

// ADR-0013 "Rates, time and greeks": the CDI annual rate is compounded over 252 business
// days, so the model's continuous rate is r = ln(1 + cdi).
export function resolveRiskFreeRate(macro: readonly MacroPoint[], at: Instant): string {
  const cdiPoint = latestVisible(
    macro.filter((m) => m.series === "cdi"),
    at,
  );
  return toDecimalString(
    cdiPoint ? new Decimal(1).add(parseDecimal(cdiPoint.annualRate)).ln() : new Decimal(0),
    RATIO_SCALE,
  );
}

export type DividendYieldResolution = { value: string; notes: Note[] };

// The dividend yield is an annual simple yield converted to the model's continuous yield
// q = ln(1 + annualYield); zero with a note when none is visible for the underlying.
export function resolveDividendYield(
  dividendYields: readonly DividendYieldPoint[],
  underlying: Ticker,
  at: Instant,
): DividendYieldResolution {
  const point = latestVisible(
    dividendYields.filter((d) => d.underlying === underlying),
    at,
  );
  if (!point) {
    return {
      value: toDecimalString(new Decimal(0), RATIO_SCALE),
      notes: [
        { code: "dividend_yield_defaulted", message: "no dividend yield visible; defaulted to 0" },
      ],
    };
  }
  return {
    value: toDecimalString(new Decimal(1).add(parseDecimal(point.annualYield)).ln(), RATIO_SCALE),
    notes: [],
  };
}
