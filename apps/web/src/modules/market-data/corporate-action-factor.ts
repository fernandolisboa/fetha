import Decimal from "decimal.js";
import { decimalStringSchema, type DecimalString, type Quantity } from "@fetha/contracts";

const FACTOR_SCALE = 8;

// The multiplier ADR-0013 applies to every session before the ex-date:
// "every `sharesBefore` shares become `sharesAfter`", so `factor =
// sharesBefore / sharesAfter` (a 2-for-1 split, 1 -> 2, halves earlier
// prices: factor 0.5). Rounded half-even, decimal.js throughout (CLAUDE.md
// "never JavaScript number for money" extends to this ratio: JS float
// division of two small integers can already miss the exact eighth decimal
// this column stores).
export function sharesRatioToFactor(sharesBefore: Quantity, sharesAfter: Quantity): DecimalString {
  const factor = new Decimal(sharesBefore)
    .dividedBy(sharesAfter)
    .toDecimalPlaces(FACTOR_SCALE, Decimal.ROUND_HALF_EVEN);
  return decimalStringSchema.parse(factor.toFixed(FACTOR_SCALE));
}

// `1` is the owner's documented way to neutralize a mistaken entry (no
// delete exists, ADR-0052): a 1.0 row still triggers the engine's own
// stale-price suppression around any exDate it names
// (packages/engine/src/internal/price-operation.ts), so market-data must
// keep it out of the `corporateActions` collection handed to the engine
// while still counting its `recordedAt` in `dataVersion` (the write still
// has to fail a chunked run in progress).
export function isNeutralFactor(factor: DecimalString): boolean {
  return new Decimal(factor).equals(1);
}
