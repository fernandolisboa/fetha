import {
  quantitySchema,
  sessionDateSchema,
  type SessionDate,
  type ThesisClaim,
} from "@fetha/contracts";
import type { Leg, OperationPricing } from "@fetha/engine";

import type { RadarLeg } from "./match";

// B3's standard lot for stock options (docs/adr/0067): a suggestion is priced for one lot per
// unit of its structure's ratio, so its premium, max loss and max gain read as the amounts of a
// real order. Sizing to the user's capital stays theirs, in the builder.
export const SUGGESTION_LOT = quantitySchema.parse(100);

export interface SuggestionDraft {
  legs: Leg[];
  pricing: OperationPricing;
  claim: ThesisClaim;
  horizon: SessionDate;
}

// The suggestion's thesis claim (ADR-0014, docs/adr/0067): with one break-even the structure
// gains on one side of it at expiry, read from the engine's own payoff at its highest
// underlying; with none or several (a butterfly, a straddle), the claim is that the operation
// ends with a positive P&L.
export function suggestionClaim(pricing: OperationPricing): ThesisClaim {
  const [breakEven, ...others] = pricing.breakEvens;
  const highest = pricing.payoff.reduce<OperationPricing["payoff"][number] | null>(
    (top, point) => (!top || Number(point.underlying) > Number(top.underlying) ? point : top),
    null,
  );
  if (breakEven === undefined || others.length > 0 || !highest || highest.pnl === 0) {
    return { kind: "operation_pnl_positive" };
  }
  return {
    kind: highest.pnl > 0 ? "close_above" : "close_below",
    instrument: pricing.underlying,
    level: breakEven,
  };
}

// The options' shared expiry, the suggestion's horizon; null when the legs disagree or carry
// none (ADR-0014 Q43: one structure, one expiry).
export function suggestionHorizon(legs: readonly RadarLeg[]): SessionDate | null {
  const expiries = new Set(legs.flatMap((leg) => (leg.expiry ? [leg.expiry] : [])));
  const [expiry, ...others] = [...expiries];
  if (expiry === undefined || others.length > 0) return null;
  return sessionDateSchema.parse(expiry);
}

// A match becomes a suggestion only when the engine priced every leg (each price is the entry
// the suggestion is scored from), its max loss is bounded and its options share one expiry.
export function suggestionFrom(
  pricing: OperationPricing,
  legs: readonly RadarLeg[],
): SuggestionDraft | null {
  if (pricing.maxLoss === "unbounded") return null;
  if (pricing.legs.some((leg) => leg.price === null)) return null;
  const horizon = suggestionHorizon(legs);
  if (horizon === null) return null;
  return {
    legs: pricing.legs.map(({ leg }) => leg),
    pricing,
    claim: suggestionClaim(pricing),
    horizon,
  };
}
