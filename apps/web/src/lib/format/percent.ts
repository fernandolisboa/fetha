import { Decimal } from "decimal.js";
import type { DecimalString } from "@fetha/contracts";

const MINUS_SIGN = "−";

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

// The engine expresses fractions (0.0208, not 2.08); DESIGN.md's pt-BR
// formatting rule wants the percentage form with a comma decimal, at most
// two decimals and no forced trailing zero, e.g. "2,08%" or "28,4%", with
// a true minus (formatBRL's own MINUS_SIGN, not Intl's default
// hyphen-minus). The sign is read off the value *after* rounding to two
// decimals, not the raw fraction: an unrounded "-0.00001" must render
// "0,00%", never "−0,00%".
export function formatPercent(fraction: DecimalString): string {
  const decimal = new Decimal(fraction).times(100).toDecimalPlaces(2);
  const formatted = percentFormatter.format(decimal.abs().toNumber());
  const sign = decimal.isNegative() && !decimal.isZero() ? MINUS_SIGN : "";
  return `${sign}${formatted}%`;
}
