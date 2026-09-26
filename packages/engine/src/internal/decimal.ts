import Decimal from "decimal.js";
import type { DecimalString } from "@fetha/contracts";
import { invariant } from "./invariant";

export const PRICE_SCALE = 2;
export const RATIO_SCALE = 6;
export const CENTAVOS_PER_REAL = 10 ** PRICE_SCALE;

export function parseDecimal(value: DecimalString): Decimal {
  return new Decimal(value);
}

export function toDecimalString(value: Decimal, scale: number): DecimalString {
  invariant(value.isFinite(), `toDecimalString: value must be finite, got ${value.toString()}`);
  const rounded = value.toDecimalPlaces(scale);
  const canonical = rounded.isZero() ? rounded.abs() : rounded;
  return canonical.toFixed(scale) as DecimalString;
}

// A listed strike (or any other already-exact value) formatted at no less precision than it
// actually carries: `PRICE_SCALE` alone would round "11.005" to "11.01", silently changing the
// value rather than just its trailing-zero form.
export function toDecimalStringAtLeastScale(value: Decimal, minScale: number): DecimalString {
  return toDecimalString(value, Math.max(minScale, value.decimalPlaces()));
}

export const ZERO_RATIO = toDecimalString(new Decimal(0), RATIO_SCALE);
