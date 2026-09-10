import { Decimal } from "decimal.js";
import type { DecimalString } from "@fetha/contracts";

const MINUS_SIGN = "−";

const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// For plain ratios that aren't currency or a percentage (Sharpe, profit
// factor): same pt-BR comma decimal and true minus as formatBRL and
// formatPercent (DESIGN.md "Formatting (pt-BR)"), but no unit suffix. The
// engine's own precision (six decimal places, ADR-0013) is never shown
// verbatim on screen.
export function formatDecimal(value: DecimalString): string {
  const decimal = new Decimal(value);
  const formatted = decimalFormatter.format(decimal.abs().toNumber());
  const sign = decimal.isNegative() ? MINUS_SIGN : "";
  return `${sign}${formatted}`;
}
