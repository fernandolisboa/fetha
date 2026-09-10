import Decimal from "decimal.js";
import type { SessionDate } from "@fetha/contracts";
import type { CorporateActionFactor } from "../api";

// The product of every split/reverse-split factor between an operation's own entry and a later
// session (exclusive of the entry, inclusive of `through`): the multiplier that turns the
// nominal share count and entry price recorded at entry into the effective count and price
// comparable with `through`'s own nominal candles (ADR-0013 "Candles and corporate actions";
// ADR-0014 Q51). Shared by evaluateStrategy (rebasing its own exit-rule comparisons),
// runBacktest (marks, fills and P&L on an open leg) and mark-to-market.ts / proposeSettlement
// (unrealized P&L) so none of them drift, per ADR-0013's #25 addendum. The caller is
// responsible for having already filtered `factors` down to what is visible at the instant in
// question — this function does not read `asOf`.
export function splitFactorProduct(
  factors: readonly CorporateActionFactor[],
  openedAt: SessionDate,
  through: SessionDate,
): Decimal {
  return factors.reduce((acc, f) => {
    if (f.exDate > openedAt && f.exDate <= through) return acc.mul(new Decimal(f.factor));
    return acc;
  }, new Decimal(1));
}
