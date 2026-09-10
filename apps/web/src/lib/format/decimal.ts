import { Decimal } from "decimal.js";
import type { DecimalString } from "@fetha/contracts";

const MINUS_SIGN = "−";

// pt-BR decimal formatting for prices, strikes, greeks and plain ratios
// (Sharpe, profit factor): comma decimal separator, no thousands
// separator (these are per-unit values, never money), true minus sign as
// formatBRL and formatPercent (DESIGN.md "Formatting (pt-BR)"). Default two
// decimals; greeks pass 4 (DESIGN.md: "two decimals for stocks and
// options, four for rates/greeks"). The engine's own precision (six
// decimal places, ADR-0013) is never shown verbatim on screen.
export function formatDecimal(value: DecimalString, decimals = 2): string {
  const decimal = new Decimal(value);
  const formatter = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const rounded = decimal.abs().toDecimalPlaces(decimals);
  const formatted = formatter.format(rounded.toNumber());
  const sign = decimal.isNegative() && !rounded.isZero() ? MINUS_SIGN : "";
  return `${sign}${formatted}`;
}
