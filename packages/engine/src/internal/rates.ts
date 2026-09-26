import Decimal from "decimal.js";
import type { DecimalString, Instant, Ticker } from "@fetha/contracts";
import type { DividendYieldPoint, EngineError, MacroPoint, Note } from "../api";
import { parseDecimal, RATIO_SCALE, toDecimalString, ZERO_RATIO } from "./decimal";
import { latestVisibleIndexed, rowsWithKey } from "./view-index";

const seriesOf = (m: MacroPoint): string => m.series;
const underlyingOf = (d: DividendYieldPoint): string => d.underlying;

export type RateResolution =
  { ok: true; value: DecimalString; notes: Note[] } | { ok: false; error: EngineError };

function invalidAnnualRate(path: string): { ok: false; error: EngineError } {
  return {
    ok: false,
    error: { code: "invalid_input", path, message: "annual rate must be greater than -1" },
  };
}

// ADR-0013 "Rates, time and greeks": the CDI annual rate is compounded over 252 business
// days, so the model's continuous rate is r = ln(1 + cdi). A rate at or below -1 makes
// 1 + cdi non-positive, which decimal.js's ln() throws on, so it is rejected before the
// conversion rather than left to throw out of the pricing seam.
export function resolveRiskFreeRate(macro: readonly MacroPoint[], at: Instant): RateResolution {
  const cdiPoint = latestVisibleIndexed(rowsWithKey(macro, seriesOf, "cdi"), at);
  if (!cdiPoint) {
    return {
      ok: true,
      value: ZERO_RATIO,
      notes: [{ code: "risk_free_rate_defaulted", message: "no cdi rate visible; defaulted to 0" }],
    };
  }
  const annualRate = parseDecimal(cdiPoint.annualRate);
  if (annualRate.lte(-1)) return invalidAnnualRate("macro.cdi.annualRate");
  return {
    ok: true,
    value: toDecimalString(new Decimal(1).add(annualRate).ln(), RATIO_SCALE),
    notes: [],
  };
}

// The dividend yield is an annual simple yield converted to the model's continuous yield
// q = ln(1 + annualYield); zero with a note when none is visible for the underlying.
export function resolveDividendYield(
  dividendYields: readonly DividendYieldPoint[],
  underlying: Ticker,
  at: Instant,
): RateResolution {
  const point = latestVisibleIndexed(rowsWithKey(dividendYields, underlyingOf, underlying), at);
  if (!point) {
    return {
      ok: true,
      value: ZERO_RATIO,
      notes: [
        { code: "dividend_yield_defaulted", message: "no dividend yield visible; defaulted to 0" },
      ],
    };
  }
  const annualYield = parseDecimal(point.annualYield);
  if (annualYield.lte(-1)) return invalidAnnualRate("dividendYields.annualYield");
  return {
    ok: true,
    value: toDecimalString(new Decimal(1).add(annualYield).ln(), RATIO_SCALE),
    notes: [],
  };
}
