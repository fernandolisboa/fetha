import { Decimal } from "decimal.js";
import type { DecimalString } from "@fetha/contracts";
import type { OptionRight } from "@fetha/engine";

// A short leg one session from expiry is assignment risk when it is already in the money, or
// close enough to the money that a session's own move could put it there (#382): a strike within
// 1% of spot either way, the same width the builder's own series-picker `moneyness` uses for its
// "at" band, so a call struck fractionally above spot (a 30,25 strike against a 30,00 close)
// still counts.
const ASSIGNMENT_RISK_BAND = new Decimal("0.01");

export function isShortLegAssignmentRisk(
  right: OptionRight,
  strike: DecimalString,
  spot: DecimalString,
): boolean {
  const spotValue = new Decimal(spot);
  const strikeValue = new Decimal(strike);
  const inTheMoney = right === "call" ? spotValue.gte(strikeValue) : spotValue.lte(strikeValue);
  if (inTheMoney) {
    return true;
  }
  return strikeValue.minus(spotValue).abs().lte(spotValue.times(ASSIGNMENT_RISK_BAND));
}
