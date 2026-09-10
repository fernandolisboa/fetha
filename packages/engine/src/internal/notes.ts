import type { Note } from "../api";

// Shared literal `Note` messages now at their third independent copy (round 3 item 10):
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
