import { Decimal } from "decimal.js";
import { decimalStringSchema, type DecimalString } from "@fetha/contracts";

// A limit order never costs more to buy, or raises less to sell, than the plan promised: the
// tolerance (e.g. "0.01" for 1%) moves the last price against the user, up for a buy, down for a
// sell.
export function limitPriceForLeg(
  side: "buy" | "sell",
  lastPrice: DecimalString,
  tolerance: DecimalString,
): DecimalString {
  const base = new Decimal(lastPrice);
  const factor = new Decimal(tolerance);
  const adjusted =
    side === "buy"
      ? base.times(new Decimal(1).plus(factor))
      : base.times(new Decimal(1).minus(factor));
  return decimalStringSchema.parse(Decimal.max(adjusted, 0).toFixed(6));
}
