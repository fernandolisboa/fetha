import { Decimal } from "decimal.js";
import { leftOpenUnitIntervalSchema, type DecimalString } from "@fetha/contracts";

// Renders a fraction ("0.02") as a pt-BR percentage string ("2%"), matching
// DESIGN.md's "at most two decimals" rule.
export function formatPercent(fraction: DecimalString): string {
  const value = Number(fraction) * 100;
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toString().replace(".", ",")}%`;
}

// Seeds an editable percent input from a stored fraction without the
// two-decimal rounding `formatPercent` applies for display, so re-opening
// the risk profile form never silently narrows a declared limit (round 1
// item 16: 0.02345 stored as "2%" would save back as 0.02, not 0.02345).
export function fractionToPercentInputValue(fraction: DecimalString): string {
  const percent = new Decimal(fraction).times(100).toFixed(6);
  return trimTrailingZeros(percent).replace(".", ",");
}

function trimTrailingZeros(decimal: string): string {
  if (!decimal.includes(".")) return decimal;
  const trimmed = decimal.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

// Parses a pt-BR percent input ("2" or "2,5") into the fraction
// `RiskProfile["limits"]` stores; null when it is not strictly between 0
// (exclusive) and 100 (inclusive), matching `leftOpenUnitIntervalSchema`.
export function parsePercentToFraction(input: string): DecimalString | null {
  const trimmed = input.trim().replace(",", ".");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;

  const fraction = value / 100;
  const normalized = trimTrailingZeros(fraction.toFixed(6));
  const result = leftOpenUnitIntervalSchema.safeParse(normalized);
  return result.success ? result.data : null;
}
