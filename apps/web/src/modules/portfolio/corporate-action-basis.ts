import Decimal from "decimal.js";
import { decimalStringSchema, type SessionDate } from "@fetha/contracts";
import type { CorporateActionFactor } from "@fetha/engine";

import { holdingKey, type LedgerFill } from "./bookkeeping";

const NORMALIZED_PRICE_SCALE = 8;

// Mirrors packages/engine/src/internal/split-factor.ts's `splitFactorProduct` exactly: the
// product of every split/reverse-split factor whose `exDate` falls in `(openedAt, through]`.
// The engine's interface is frozen (ADR-0013) and does not export this helper, so the portfolio
// edge keeps its own copy rather than reaching into engine internals (CLAUDE.md "never depend on
// engine internals from outside the package"); both copies are tiny and reviewed together.
export type SplitFactorResult =
  { ok: true; value: Decimal } | { ok: false; reason: "non_positive_factor" };

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
      return { ok: false, reason: "non_positive_factor" };
    }
    acc = acc.mul(factor);
  }
  return { ok: true, value: acc };
}

export interface NormalizeFillsResult<T extends LedgerFill> {
  fills: T[];
  // True when at least one fill's rebased quantity was not a whole number (a corporate-action
  // factor that does not evenly divide that fill's own quantity, e.g. a bonus or grouping that
  // does not land on a whole share for this particular fill): every fill of the operation is
  // then returned unchanged, never partially or silently rounded, and the caller surfaces this
  // so the user knows the position may not reflect the corporate action.
  skipped: boolean;
}

// #271: "each fill is recorded as the broker showed it on its own date." The engine rebases an
// operation's nominal `leg.quantity`/`entryPrice` forward from `openedAt` by the product of every
// split factor visible between `openedAt` and the mark session (ADR-0014 Q51). A fill entered
// exactly as the broker showed it on its own, later session is already on the *post-split* basis,
// not the operation's own nominal (`openedAt`) basis the engine expects — summing it directly
// with an earlier, pre-split fill nets apples against oranges. Converting it back here, by the
// inverse of the same factor, puts every fill on the one basis `holdingsFromFills` can net
// correctly; the engine's own forward rebase at mark time then reproduces the real, current
// quantity the broker shows.
export function normalizeFillsForOperationBasis<T extends LedgerFill>(
  fills: readonly T[],
  openedAt: SessionDate,
  factors: readonly CorporateActionFactor[],
): NormalizeFillsResult<T> {
  if (factors.length === 0) {
    return { fills: [...fills], skipped: false };
  }

  const normalized: T[] = [];
  for (const fill of fills) {
    const factorResult = splitFactorProduct(factors, openedAt, fill.session);
    if (!factorResult.ok || factorResult.value.eq(1)) {
      normalized.push(fill);
      continue;
    }
    const factor = factorResult.value;
    const rebasedQuantity = new Decimal(fill.quantity).mul(factor);
    if (!rebasedQuantity.eq(rebasedQuantity.round())) {
      return { fills: [...fills], skipped: true };
    }
    normalized.push({
      ...fill,
      quantity: rebasedQuantity.toNumber(),
      price: decimalStringSchema.parse(
        new Decimal(fill.price).div(factor).toFixed(NORMALIZED_PRICE_SCALE),
      ),
    });
  }
  return { fills: normalized, skipped: false };
}

// #271: the same rule applied to holdings *outside* any operation (ADR-0021 item 5's bare
// `Position`s): each (ticker, expiry) holding has no operation to share an `openedAt` with, so
// it is normalized against its own earliest fill's session instead. A group whose rebase is
// refused (non-integer) is returned unchanged, same as `normalizeFillsForOperationBasis`.
export function normalizeFillsForHoldingsBasis<T extends LedgerFill>(
  fills: readonly T[],
  underlyingOf: (fill: T) => string | null,
  corporateActionsByUnderlying: ReadonlyMap<string, readonly CorporateActionFactor[]>,
): T[] {
  const groups = new Map<string, T[]>();
  for (const fill of fills) {
    const key = holdingKey(fill.ticker, fill.expiry);
    const group = groups.get(key);
    if (group) {
      group.push(fill);
    } else {
      groups.set(key, [fill]);
    }
  }

  const normalized: T[] = [];
  for (const group of groups.values()) {
    const [first] = group;
    const openedAt = group.map((f) => f.session).sort()[0];
    const underlying = first ? underlyingOf(first) : null;
    if (!openedAt || !underlying) {
      normalized.push(...group);
      continue;
    }
    const factors = corporateActionsByUnderlying.get(underlying) ?? [];
    normalized.push(...normalizeFillsForOperationBasis(group, openedAt, factors).fills);
  }
  return normalized;
}
