import { Decimal } from "decimal.js";
import { leftOpenUnitIntervalSchema, type DecimalString } from "@fetha/contracts";

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
