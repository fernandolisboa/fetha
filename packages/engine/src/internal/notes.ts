import type { LegValuation, Note } from "../api";

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

// runBacktest's own mark path (issue #273): a leg's last known price (ADR-0014 Q42) whose own
// session predates a corporate-action ex-date visible on the underlying is rescaled by the same
// factor its quantity already carries (`corporateActionFactorThrough`), rather than left to sit
// on the pre-action scale the already-rebased effective quantity no longer shares. Shares its
// code with `option-pricing.ts`'s IV-suppression note (same underlying situation, a different
// consequence — there the price is never rescaled, only the solve is suppressed; here the mark
// itself is), rolled up into one run-wide note the same way the strike-adjustment notes below are.
export const STALE_MARK_RESCALED_ACROSS_CORPORATE_ACTION_NOTE: Note = {
  code: "stale_price_across_corporate_action",
  message:
    "a leg's stale mark predated a corporate-action ex-date visible on its underlying; it was rescaled by the factor(s) since the price's own session (ADR-0014 Q51)",
};

// The only two codes a single leg's own strike adjustment can ever repeat under (forwarded from
// a settlement proposal computed against the same leg/session by more than one caller, #69 part
// 2 correctness rounds 3-5): safe to dedup by code alone, unlike every other note code (e.g.
// `stale_price`), which is parameterized per leg and must never be collapsed across legs.
export const STRIKE_ADJUSTMENT_CODES: ReadonlySet<Note["code"]> = new Set([
  OPTION_STRIKE_DERIVED_NOTE.code,
  OPTION_STRIKE_UNCONFIRMED_NOTE.code,
]);

// Pulls the two codes above out of a set of per-leg `LegValuation.notes` (an exit-rule base's or
// an entry proposal's own pricing, issue #269), deduped to at most one note per code — the same
// roll-up `score.ts`'s own `anyDerived`/`anyUnconfirmed` pattern already applies to its scored
// legs. Shared by `evaluate-strategy.ts` (the exit-rule-base and entry-proposal paths) and
// `run-backtest.ts` (the entry-fill path), so every caller rolls the same two codes up the same
// way.
export function strikeAdjustmentNotesOf(legs: readonly Pick<LegValuation, "notes">[]): Note[] {
  const codes = new Set(legs.flatMap((leg) => leg.notes.map((n) => n.code)));
  const notes: Note[] = [];
  if (codes.has(OPTION_STRIKE_DERIVED_NOTE.code)) notes.push(OPTION_STRIKE_DERIVED_NOTE);
  if (codes.has(OPTION_STRIKE_UNCONFIRMED_NOTE.code)) notes.push(OPTION_STRIKE_UNCONFIRMED_NOTE);
  return notes;
}
