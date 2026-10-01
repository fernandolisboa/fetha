import Decimal from "decimal.js";
import type { SessionDate } from "@fetha/contracts";
import type { CorporateActionFactor, EngineError } from "../api";

export type SplitFactorResult = { ok: true; value: Decimal } | { ok: false; error: EngineError };

// The product of every split/reverse-split factor between an operation's own entry and a later
// session (exclusive of the entry, inclusive of `through`): the multiplier that turns the
// nominal share count and entry price recorded at entry into the effective count and price
// comparable with `through`'s own nominal candles (ADR-0013 "Candles and corporate actions";
// ADR-0014 Q51). Shared by evaluateStrategy (rebasing its own exit-rule comparisons),
// runBacktest (marks, fills and P&L on an open leg) and mark-to-market.ts / proposeSettlement
// (unrealized P&L) so none of them drift, per ADR-0013's #25 addendum. The caller is
// responsible for having already filtered `factors` down to what is visible at the instant in
// question — this function does not read `asOf`. A non-positive factor (a data-integrity issue
// in ingested corporate-action data, not a caller mistake) would silently zero or invert every
// price it touches, so it is rejected here once for every caller rather than
// validated twice.
export function splitFactorProduct(
  factors: readonly CorporateActionFactor[],
  openedAt: SessionDate,
  through: SessionDate,
): SplitFactorResult {
  let acc = new Decimal(1);
  for (const f of factors) {
    if (f.exDate <= openedAt || f.exDate > through) continue;
    const factor = new Decimal(f.factor);
    if (!factor.gt(0)) {
      return {
        ok: false,
        error: {
          code: "invalid_input",
          path: "corporateActions[].factor",
          message: "a corporate-action factor must be positive",
        },
      };
    }
    acc = acc.mul(factor);
  }
  return { ok: true, value: acc };
}

// Issue #273/#279: a carried-forward price (`stale`, ADR-0014 Q42) sits on the scale of its own
// session, which a factor ex-dated since then has already moved the rebased quantity away from.
// Rescaling by the product over `(staleSession, through]` puts it back on the scale the caller's
// effective quantity expects. Shared by mark-to-market.ts and score.ts so neither measures the
// window its own way; runBacktest keeps its own copy over its pre-indexed factors.
export function rescaleStalePrice(
  factors: readonly CorporateActionFactor[],
  price: Decimal,
  staleSession: SessionDate | null,
  through: SessionDate,
): { ok: true; value: { price: Decimal; rescaled: boolean } } | { ok: false; error: EngineError } {
  if (staleSession === null) return { ok: true, value: { price, rescaled: false } };
  const factor = splitFactorProduct(factors, staleSession, through);
  if (!factor.ok) return factor;
  if (factor.value.eq(1)) return { ok: true, value: { price, rescaled: false } };
  return { ok: true, value: { price: price.mul(factor.value), rescaled: true } };
}
