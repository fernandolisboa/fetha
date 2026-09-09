import Decimal from "decimal.js";
import type { DecimalString } from "@fetha/contracts";

export const PRICE_SCALE = 2;
export const RATIO_SCALE = 6;
export const CENTAVOS_PER_REAL = 10 ** PRICE_SCALE;

export function parseDecimal(value: DecimalString): Decimal {
  return new Decimal(value);
}

export function toDecimalString(value: Decimal, scale: number): DecimalString {
  const rounded = value.toDecimalPlaces(scale);
  const canonical = rounded.isZero() ? rounded.abs() : rounded;
  return canonical.toFixed(scale) as DecimalString;
}
