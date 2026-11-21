import { Decimal } from "decimal.js";
import type { DecimalString } from "@fetha/contracts";
import type { OptionRight } from "@fetha/engine";

// ITM-or-ATM by strike vs spot alone, never the builder's own series-picker `moneyness` with its
// +/-1% "at" band (#382): that band exists only so two adjacent rows in a picker
// never flip labels on a rounding difference. A short leg one session from expiry needs the
// literal comparison instead, since a broker's automatic exercise does not care whether a
// strike reads as "near" the money — a call struck fractionally below spot is still assignable.
export function isShortLegAssignmentRisk(
  right: OptionRight,
  strike: DecimalString,
  spot: DecimalString,
): boolean {
  const comparison = new Decimal(spot).comparedTo(strike);
  return right === "call" ? comparison >= 0 : comparison <= 0;
}
