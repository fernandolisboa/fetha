import { Decimal } from "decimal.js";
import type { DecimalString } from "@fetha/contracts";

const MINUS_SIGN = "−";

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// The engine expresses fractions (0.0208, not 2.08); DESIGN.md's pt-BR
// formatting rule wants the percentage form with a comma decimal and a
// true minus, e.g. "2,08%" or "−1,50%" (formatBRL's own MINUS_SIGN, not
// Intl's default hyphen-minus).
export function formatPercent(fraction: DecimalString): string {
  const decimal = new Decimal(fraction).times(100);
  const formatted = percentFormatter.format(decimal.abs().toNumber());
  const sign = decimal.isNegative() ? MINUS_SIGN : "";
  return `${sign}${formatted}%`;
}
