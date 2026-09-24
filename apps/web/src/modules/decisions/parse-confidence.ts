import { Decimal } from "decimal.js";
import { confidenceSchema, type Confidence } from "@fetha/contracts";

// Digits only, at most one decimal separator (comma or dot): rejects
// anything `Number()` would silently accept but a pt-BR percent field never
// means, e.g. "0x40" (hex) or "1e1" (exponent notation) — round 2 finding 7.
const PT_BR_DECIMAL = /^\d+([.,]\d+)?$/;

// The DecisionBar shows confidence as a 0-100 percent input (DESIGN.md
// formatting: "62%") but stores it as the engine's `Confidence`, a decimal
// string in [0, 1] (`confidenceSchema`). Mirrors
// `lib/format/percent.ts#parsePercentToFraction`, but confidence's own
// bound is 0 to 1 inclusive on both ends, not `leftOpenUnitIntervalSchema`'s
// (0, 1]. Builds `Decimal` from the normalized string, never via `Number`,
// so no float rounding or notation surprise reaches the stored fraction.
export function parseConfidencePercent(raw: string): Confidence | null {
  const trimmed = raw.trim();
  if (trimmed === "" || !PT_BR_DECIMAL.test(trimmed)) return null;

  const normalizedInput = trimmed.replace(",", ".");
  const fraction = new Decimal(normalizedInput).dividedBy(100);
  const normalized = trimTrailingZeros(fraction.toFixed(6));
  const result = confidenceSchema.safeParse(normalized);
  return result.success ? result.data : null;
}

function trimTrailingZeros(decimal: string): string {
  if (!decimal.includes(".")) return decimal;
  const trimmed = decimal.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}
