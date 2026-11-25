import { Decimal } from "decimal.js";
import type { DecimalString } from "@fetha/contracts";

const LOWER_FLOOR = new Decimal("0.005");
const UPPER_CEILING = new Decimal("0.995");

// ADR-0082: a model figure never prints as a certainty, so the two extremes read "< 1%" and
// "> 99%" instead of "0%" or "100%"; every value in between rounds half up to a whole percent.
export function formatProbabilityOfProfit(probability: DecimalString): string {
  const value = new Decimal(probability);
  if (value.lt(LOWER_FLOOR)) return "< 1%";
  if (value.gte(UPPER_CEILING)) return "> 99%";
  const percent = value.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return `${percent.toFixed(0)}%`;
}
