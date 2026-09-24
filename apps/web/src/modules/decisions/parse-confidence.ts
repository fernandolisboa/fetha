import { Decimal } from "decimal.js";
import { confidenceSchema, type Confidence } from "@fetha/contracts";

// The DecisionBar shows confidence as a 0-100 percent input (DESIGN.md
// formatting: "62%") but stores it as the engine's `Confidence`, a decimal
// string in [0, 1] (`confidenceSchema`). Mirrors
// `lib/format/percent.ts#parsePercentToFraction`, but confidence's own
// bound is 0 to 1 inclusive on both ends, not `leftOpenUnitIntervalSchema`'s
// (0, 1].
export function parseConfidencePercent(raw: string): Confidence | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;

  const fraction = new Decimal(value).dividedBy(100);
  const normalized = trimTrailingZeros(fraction.toFixed(6));
  const result = confidenceSchema.safeParse(normalized);
  return result.success ? result.data : null;
}

function trimTrailingZeros(decimal: string): string {
  if (!decimal.includes(".")) return decimal;
  const trimmed = decimal.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}
