import Decimal from "decimal.js";
import {
  decimalStringSchema,
  quantitySchema,
  type Centavos,
  type DecimalString,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import type { CorporateActionFactor, LegSettlement, SettlementOutcome } from "@fetha/engine";

import { splitFactorProduct } from "./corporate-action-basis";
import type { AssetClass, FillSide } from "./schema";

export interface LegChoice {
  ticker: Ticker;
  outcome: Exclude<SettlementOutcome, "kept">;
  price: DecimalString;
  costsCentavos: number;
}

export interface SettlementFill {
  ticker: Ticker;
  assetClass: AssetClass;
  side: FillSide;
  quantity: number;
  price: DecimalString;
  session: SessionDate;
  costsCentavos: number;
  expiry: SessionDate | null;
}

export type SettlementPlan =
  { ok: true; fills: SettlementFill[] } | { ok: false; reason: "invalid_choice" };

const ZERO_PRICE = decimalStringSchema.parse("0");

function opposite(side: FillSide): FillSide {
  return side === "buy" ? "sell" : "buy";
}

// ADR-0063: a cash-settled leg (e.g. an Ibovespa option) never produces a fill on the
// underlying, so its settlement cash flow is carried on this same ledger as the closing
// option fill's own price instead of the usual `ZERO_PRICE` worthless close. The closing
// fill's side is already the leg's opposite (set by its caller), which gives `cashCentavos`
// (bookkeeping.ts) the right sign on its own; this only has to supply the right magnitude.
function cashSettlementClosePrice(
  cashSettlementValue: Centavos | null,
  quantity: number,
): DecimalString {
  if (cashSettlementValue == null || cashSettlementValue === 0) return ZERO_PRICE;
  const perUnit = new Decimal(Math.abs(cashSettlementValue)).div(100).div(quantity);
  return decimalStringSchema.parse(perUnit.toFixed(6));
}

// ADR-0014 Q41: exercise buys the underlying for a long call and sells it
// for a long put; assignment is the writer's mirror image.
function stockSide(role: "call" | "put", side: FillSide): FillSide {
  const longSide: FillSide = role === "call" ? "buy" : "sell";
  return side === "buy" ? longSide : opposite(longSide);
}

// #282: the one count each option leg closes at, shared by `planSettlement` (the fill it writes),
// the settlement dialog (the quantity it shows) and `confirmSettlementAction` (the quantity it
// checks), so the user confirms exactly what the ledger stores. Every stored fill is read back
// as "the broker showed it on its own date" (ADR-0021 item 1), so the closing fill is written on
// the broker basis at expiry: the engine's own rebased fill when there is one, otherwise
// `leg.quantity ÷ F` over `(openedAt, expiry]` (the window the engine caps an option leg at).
// Only a leg the rebase dissolves below one effective unit falls back to the nominal count, since
// no broker-basis count smaller than one share exists. A non-positive factor, or one that pushes
// the count outside `Quantity`'s bounds, is corrupt data and refused rather than written.
export function closingQuantities(
  openedAt: SessionDate,
  expiry: SessionDate,
  corporateActions: readonly CorporateActionFactor[],
  proposal: readonly LegSettlement[],
): ReadonlyMap<Ticker, number> | null {
  const factor = splitFactorProduct(corporateActions, openedAt, expiry);
  if (!factor.ok) return null;
  const quantities = new Map<Ticker, number>();
  for (const settlement of proposal) {
    if (settlement.leg.role === "stock") continue;
    const delivered = settlement.fills[0]?.quantity;
    const rebased = new Decimal(settlement.leg.quantity).div(factor.value).floor();
    const quantity = delivered ?? (rebased.gte(1) ? rebased.toNumber() : settlement.leg.quantity);
    if (!quantitySchema.safeParse(quantity).success) return null;
    quantities.set(settlement.leg.ticker, quantity);
  }
  return quantities;
}

// ADR-0021 item 6: every open option leg closes at zero on the expiry
// session, and each exercised or assigned leg adds the stock fill the user
// confirmed. A choice must name every option leg exactly once, with an
// outcome the leg's own side allows.
export function planSettlement(
  underlying: Ticker,
  expiry: SessionDate,
  closing: ReadonlyMap<Ticker, number>,
  proposal: readonly LegSettlement[],
  choices: readonly LegChoice[],
): SettlementPlan {
  const optionLegs = proposal.flatMap((settlement) =>
    settlement.leg.role === "stock" ? [] : [settlement.leg],
  );
  if (
    choices.length !== optionLegs.length ||
    new Set(choices.map((choice) => choice.ticker)).size !== choices.length
  ) {
    return { ok: false, reason: "invalid_choice" };
  }

  const fills: SettlementFill[] = [];
  for (const settlement of proposal) {
    if (settlement.leg.role === "stock") continue;
    const leg = settlement.leg;
    const choice = choices.find((candidate) => candidate.ticker === leg.ticker);
    const allowed = leg.side === "buy" ? "exercised" : "assigned";
    const optionCloseQuantity = closing.get(leg.ticker);
    const cashValue = settlement.cashSettlementValue;
    // ADR-0062: a cash-settled leg's own cash flow is non-zero exactly when it is in the money,
    // so it can never be legitimately closed `expired_worthless`; and the engine's own sign
    // convention (a long leg's gain positive, a short leg's loss negative) must agree with the
    // side the choice is closing, or the plan would book the cash flow backwards.
    const cashSignDisagrees =
      cashValue !== null &&
      cashValue !== 0 &&
      Math.sign(cashValue) !== (leg.side === "buy" ? 1 : -1);
    const cashWorthlessDisagrees =
      cashValue !== null && cashValue !== 0 && choice?.outcome === "expired_worthless";
    if (
      !choice ||
      optionCloseQuantity === undefined ||
      (choice.outcome !== allowed && choice.outcome !== "expired_worthless") ||
      !Number.isSafeInteger(choice.costsCentavos) ||
      choice.costsCentavos < 0 ||
      choice.price.startsWith("-") ||
      cashSignDisagrees ||
      cashWorthlessDisagrees
    ) {
      return { ok: false, reason: "invalid_choice" };
    }
    // A cash-settled leg never produces the stock fill below, so the user's own costs for this
    // settlement have nowhere else to land: they belong on the closing option fill itself
    // (ADR-0062), not discarded after validation. A physically-settled leg's costs stay on the
    // stock delivery alone, as before.
    const closingCostsCentavos = settlement.cashSettlementValue !== null ? choice.costsCentavos : 0;
    fills.push({
      ticker: leg.ticker,
      assetClass: "option",
      side: opposite(leg.side),
      quantity: optionCloseQuantity,
      price: cashSettlementClosePrice(settlement.cashSettlementValue, optionCloseQuantity),
      session: expiry,
      costsCentavos: closingCostsCentavos,
      expiry,
    });
    // The real, immediate stock delivery is sized at the engine's own rebased exercise fill,
    // never the leg's nominal quantity — B3 delivers the effective (post-split) count. A factor
    // that dissolved this leg below one effective unit leaves no fill to carry over
    // (`settlement.fills` is empty); its residual value is cash-settled by the engine
    // (`residualValue`), not yet wired into a confirmed fill here (ADR-0021).
    const stockQuantity = settlement.fills[0]?.quantity;
    if (choice.outcome !== "expired_worthless" && stockQuantity !== undefined) {
      fills.push({
        ticker: underlying,
        assetClass: "stock",
        side: stockSide(leg.role, leg.side),
        quantity: stockQuantity,
        price: choice.price,
        session: expiry,
        costsCentavos: choice.costsCentavos,
        expiry: null,
      });
    }
  }
  return { ok: true, fills };
}
