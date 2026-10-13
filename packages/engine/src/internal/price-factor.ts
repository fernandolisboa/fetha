import Decimal from "decimal.js";
import type { DecimalString } from "@fetha/contracts";
import type { EngineError } from "../api";
import { parseDecimal } from "./decimal";
import { invalidInput } from "./errors";

export type PriceFactorResult = { ok: true; value: Decimal } | { ok: false; error: EngineError };

// ADR-0063: a series' `priceFactor` (B3's registry PricFctr) converts between its own
// quotation unit (index points, for an index option) and reais per contract-unit as stored:
// a figure in points divided by this factor is reais. Absent means 1 (every equity option,
// the pre-existing behaviour, left bit-identical). A non-positive factor is a data-integrity
// issue, not a caller mistake, rejected here once per caller rather than validated twice
// (mirrors split-factor.ts's own corporate-action-factor guard).
export function resolvePriceFactor(
  priceFactor: DecimalString | undefined,
  path: string,
): PriceFactorResult {
  if (priceFactor === undefined) return { ok: true, value: new Decimal(1) };
  const factor = parseDecimal(priceFactor);
  if (!factor.gt(0)) {
    return { ok: false, error: invalidInput(path, "a series price factor must be positive") };
  }
  return { ok: true, value: factor };
}
