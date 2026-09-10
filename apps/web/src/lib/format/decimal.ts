import type { DecimalString } from "@fetha/contracts";

// pt-BR decimal formatting for prices, strikes and greeks (DESIGN.md:
// "two decimals for stocks and options, four for rates/greeks"), comma
// decimal separator, no thousands separator (these are per-unit values,
// never money).
export function formatDecimal(value: DecimalString, decimals = 2): string {
  const rounded = Number(value).toFixed(decimals);
  return rounded.replace(".", ",");
}
