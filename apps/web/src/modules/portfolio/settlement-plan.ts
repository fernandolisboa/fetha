import {
  decimalStringSchema,
  type DecimalString,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import type { LegSettlement, SettlementOutcome } from "@fetha/engine";

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

// ADR-0014 Q41: exercise buys the underlying for a long call and sells it
// for a long put; assignment is the writer's mirror image.
function stockSide(role: "call" | "put", side: FillSide): FillSide {
  const longSide: FillSide = role === "call" ? "buy" : "sell";
  return side === "buy" ? longSide : opposite(longSide);
}

// ADR-0021 item 6: every open option leg closes at zero on the expiry
// session, and each exercised or assigned leg adds the stock fill the user
// confirmed. A choice must name every option leg exactly once, with an
// outcome the leg's own side allows.
export function planSettlement(
  underlying: Ticker,
  expiry: SessionDate,
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
    if (
      !choice ||
      (choice.outcome !== allowed && choice.outcome !== "expired_worthless") ||
      !Number.isSafeInteger(choice.costsCentavos) ||
      choice.costsCentavos < 0 ||
      choice.price.startsWith("-")
    ) {
      return { ok: false, reason: "invalid_choice" };
    }
    // The closing fill nets the ledger's own internal, nominal-basis tracking of this series to
    // zero (ADR-0021 item 2: a fill is the only stored fact); `leg.quantity` is always on that
    // same basis, regardless of any corporate-action factor.
    fills.push({
      ticker: leg.ticker,
      assetClass: "option",
      side: opposite(leg.side),
      quantity: leg.quantity,
      price: ZERO_PRICE,
      session: expiry,
      costsCentavos: 0,
      expiry,
    });
    // #271: the real, immediate stock delivery is sized at the engine's own rebased exercise
    // fill, never the leg's nominal quantity — B3 delivers the effective (post-split) count.
    // A factor that dissolved this leg below one effective unit leaves no fill to carry over
    // (`settlement.fills` is empty); its residual value is cash-settled by the engine
    // (`residualValue`), not yet wired into a confirmed fill here (follow-up).
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
