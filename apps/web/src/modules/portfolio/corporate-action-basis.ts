import Decimal from "decimal.js";
import { decimalStringSchema, quantitySchema, type SessionDate } from "@fetha/contracts";
import type { CorporateActionFactor } from "@fetha/engine";

import { holdingKey, type LedgerFill } from "./bookkeeping";

const NORMALIZED_PRICE_SCALE = 8;

// Mirrors packages/engine/src/internal/split-factor.ts's `splitFactorProduct` by value: the
// engine's interface is frozen (ADR-0013) and does not export this helper, so the portfolio edge
// keeps its own copy rather than reaching into engine internals (CLAUDE.md "never depend on
// engine internals from outside the package").
export type BasisFactorResult =
  { ok: true; value: Decimal } | { ok: false; reason: "non_positive_factor" };

export function splitFactorProduct(
  factors: readonly CorporateActionFactor[],
  openedAt: SessionDate,
  through: SessionDate,
): BasisFactorResult {
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
  // True when at least one fill's rebase was refused: a non-positive factor, or a rebased
  // quantity that is not a whole, in-bounds share count. Every fill of the group is then returned
  // unchanged, never partially or silently rounded, and the caller surfaces this so the user
  // knows the position may not reflect the corporate action.
  skipped: boolean;
}

function rebasedFill<T extends LedgerFill>(
  fill: T,
  rebasedQuantity: Decimal,
  rebasedPrice: Decimal,
): T | null {
  if (!rebasedQuantity.eq(rebasedQuantity.round())) return null;
  const quantity = rebasedQuantity.toNumber();
  if (!quantitySchema.safeParse(quantity).success) return null;
  return {
    ...fill,
    quantity,
    price: decimalStringSchema.parse(rebasedPrice.toFixed(NORMALIZED_PRICE_SCALE)),
  };
}

// The engine's own effective-quantity formula (ADR-0014 Q51): quantity ÷ factor, price × factor.
// `null` when the division does not land on a whole share or falls outside `Quantity`'s bounds
// (`packages/contracts`).
function rebaseFillForward<T extends LedgerFill>(fill: T, factor: Decimal): T | null {
  if (factor.eq(1)) return fill;
  const price = new Decimal(fill.price);
  return rebasedFill(fill, new Decimal(fill.quantity).div(factor), price.mul(factor));
}

// The inverse of the engine's formula, computed by its own explicit multiplication/division
// rather than by inverting the factor and reusing `rebaseFillForward`: review round 2 item 1
// caught that `1 ÷ F` is a non-terminating decimal for a factor like 7, 3, 6 or 9, so dividing a
// fill's quantity by that inverted value introduced rounding error large enough to fail the
// whole-share check and wrongly refuse an exact rebase (F=7, quantity=100 computed
// 700.00000000000000001, not 700). quantity × factor and price ÷ factor are each a single exact
// decimal.js operation on the stored factor itself.
function rebaseFillBackward<T extends LedgerFill>(fill: T, factor: Decimal): T | null {
  if (factor.eq(1)) return fill;
  const price = new Decimal(fill.price);
  return rebasedFill(fill, new Decimal(fill.quantity).mul(factor), price.div(factor));
}

// #271: "each fill is recorded as the broker showed it on its own date." A fill dated after an
// ex-date later than `openedAt` is already on the post-split basis; converting it back by the
// inverse of the engine's own factor puts every fill of the group on one nominal basis before
// netting, so the engine's own forward rebase at mark time reproduces the real, current quantity.
// A non-positive factor, or a rebase that does not land on a whole, in-bounds share count for any
// one fill, refuses the whole group (every fill returned unchanged), never partially applied.
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
    if (!factorResult.ok) {
      return { fills: [...fills], skipped: true };
    }
    const rebased = rebaseFillBackward(fill, factorResult.value);
    if (!rebased) {
      return { fills: [...fills], skipped: true };
    }
    normalized.push(rebased);
  }
  return { fills: normalized, skipped: false };
}

export interface NormalizeFillsForwardResult<T extends LedgerFill> {
  fills: T[];
  // The `holdingKey` of every (ticker, expiry) group whose rebase was refused, unchanged and
  // surfaced the same way `NormalizeFillsResult.skipped` is for an operation.
  skippedHoldingKeys: ReadonlySet<string>;
}

// #271 review round 1 item 3: a bare holding (ADR-0021 item 5's `Position[]`) has no operation
// for the engine to forward-rebase at mark time — `markToMarket` takes `Position.quantity` and
// `averageCost` as given. Each fill is normalized forward, straight to `asOf`, rather than
// backward to the group's own earliest session: quantity ÷ factor, price × factor, factor over
// `(fill.session, asOf]` — the same per-fill rebase `normalizeFillsForOperationBasis` uses, the
// opposite direction, and a shared target instead of a shared origin.
export function normalizeFillsForHoldingsBasis<T extends LedgerFill>(
  fills: readonly T[],
  asOf: SessionDate,
  underlyingOf: (fill: T) => string | null,
  corporateActionsByUnderlying: ReadonlyMap<string, readonly CorporateActionFactor[]>,
): NormalizeFillsForwardResult<T> {
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
  const skippedHoldingKeys = new Set<string>();
  for (const [key, group] of groups) {
    const [first] = group;
    const underlying = first ? underlyingOf(first) : null;
    const factors = underlying ? (corporateActionsByUnderlying.get(underlying) ?? []) : [];
    if (factors.length === 0) {
      normalized.push(...group);
      continue;
    }
    // Review round 2 item 4: an option holding never rebases forward past its own expiry, the
    // same cap the engine itself applies (ADR-0014 Q51 windows an option leg at `openedAt` through
    // its own expiry, never beyond); a stock holding (no expiry) has no such cap.
    const through = first?.expiry && first.expiry < asOf ? first.expiry : asOf;
    const rebasedGroup: T[] = [];
    let skipped = false;
    for (const fill of group) {
      const factorResult = splitFactorProduct(factors, fill.session, through);
      const rebased = factorResult.ok ? rebaseFillForward(fill, factorResult.value) : null;
      if (!rebased) {
        skipped = true;
        break;
      }
      rebasedGroup.push(rebased);
    }
    if (skipped) {
      skippedHoldingKeys.add(key);
      normalized.push(...group);
    } else {
      normalized.push(...rebasedGroup);
    }
  }
  return { fills: normalized, skippedHoldingKeys };
}
