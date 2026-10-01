import type { Note } from "../api";

// Shared literal `Note` messages now at their third independent copy:
// option-pricing.ts, price-operation.ts and mark-to-market.ts each declared their own
// `stale_price` message, and price-operation.ts, mark-to-market.ts and stock-pricing.ts each
// declared their own `no_risk_profile` one. `Note` is plain immutable data, so one shared
// object is safe to reuse across every array it appears in.
export const STALE_PRICE_NOTE: Note = {
  code: "stale_price",
  message: "mark carried forward from the series' last trade (ADR-0014 Q42)",
};

export const NO_RISK_PROFILE_NOTE: Note = {
  code: "no_risk_profile",
  message: "no risk profile supplied; limits not checked",
};

// #69 part 2, option-strike.ts reports one of three adjustments for a
// leg's strike. `"derived"` means a visible factor, ex-dated exactly on the pricing session
// itself, was applied with confidence (no listed epoch could exist yet, this early in the same
// session). `"unconfirmed"` repurposes the legacy pre-#69 code: a visible factor ex-dated
// earlier still has no epoch confirming it, and the engine cannot tell a genuine ingestion gap
// from an already-correct, early-dated epoch (ADR-0056 backfill step 2) — the strike is kept
// as read, but flagged, since a wrong number must never be silent.
export const OPTION_STRIKE_DERIVED_NOTE: Note = {
  code: "option_strike_derived_across_corporate_action",
  message:
    "this leg's strike had no listed epoch reflecting a corporate action ex-dated on this very session yet; it was derived from the underlying's own factor",
};

export const OPTION_STRIKE_UNCONFIRMED_NOTE: Note = {
  code: "option_strike_unadjusted_across_corporate_action",
  message:
    "a corporate action is visible on the underlying with no listed epoch confirming this strike reflects it; it may not",
};

// The only two codes a single leg's own strike adjustment can ever repeat under (forwarded from
// a settlement proposal computed against the same leg/session by more than one caller, #69 part
// 2 correctness rounds 3-5): safe to dedup by code alone, unlike every other note code (e.g.
// `stale_price`), which is parameterized per leg and must never be collapsed across legs.
export const STRIKE_ADJUSTMENT_CODES: ReadonlySet<Note["code"]> = new Set([
  OPTION_STRIKE_DERIVED_NOTE.code,
  OPTION_STRIKE_UNCONFIRMED_NOTE.code,
]);
