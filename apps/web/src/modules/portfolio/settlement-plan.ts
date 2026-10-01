import Decimal from "decimal.js";
import {
  decimalStringSchema,
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
  | {
      ok: true;
      fills: SettlementFill[];
      // Review round 2 item 3: every ticker whose option-closing fill fell back to the nominal
      // `leg.quantity` because there was no broker-basis count to size it on (expired worthless,
      // or dissolved below one effective unit) — "say so" rather than let the fallback pass as a
      // confirmed broker count.
      dissolvedTickers: readonly Ticker[];
    }
  | { ok: false; reason: "invalid_choice" };

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
  openedAt: SessionDate,
  corporateActions: readonly CorporateActionFactor[],
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
  const dissolvedTickers: Ticker[] = [];
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
    // #271 review round 1 item 6: every stored fill is read back on the assumption that it is
    // recorded "as the broker showed it on its own date" (ADR-0021 item 1); writing this closing
    // fill at the nominal `leg.quantity` would be inverse-rebased a second time the next time
    // normalization reads it back, whenever a split fell between `openedAt` and expiry. It is
    // written at the engine's own rebased quantity instead, the same quantity the stock delivery
    // fill below uses, so normalization nets both to zero.
    //
    // Review round 2 item 3: an expired-worthless (or fully dissolved) leg has no stock delivery
    // fill to borrow a broker-basis count from, so it is computed the same way the engine itself
    // would (`leg.quantity ÷ F` over `(openedAt, expiry]`, the same window `buildEntryPricedLegs`
    // caps an option leg at) rather than defaulting straight to the nominal `leg.quantity` —
    // writing the nominal count here is exactly what let normalization halve an already-doubled
    // position on read-back. Only once that rebase itself produces less than one effective unit
    // (a factor large enough to dissolve the leg) does the nominal quantity stand in, because
    // there is truly no broker-basis count smaller than one share to use; `dissolvedTickers`
    // names every leg this fallback applied to, rather than letting it pass as a confirmed count.
    let optionCloseQuantity: number | undefined = settlement.fills[0]?.quantity;
    if (optionCloseQuantity === undefined) {
      const factorResult = splitFactorProduct(corporateActions, openedAt, expiry);
      const effective = factorResult.ok
        ? new Decimal(leg.quantity).div(factorResult.value).floor().toNumber()
        : 0;
      if (factorResult.ok && effective >= 1) {
        optionCloseQuantity = effective;
      } else {
        optionCloseQuantity = leg.quantity;
        dissolvedTickers.push(leg.ticker);
      }
    }
    fills.push({
      ticker: leg.ticker,
      assetClass: "option",
      side: opposite(leg.side),
      quantity: optionCloseQuantity,
      price: ZERO_PRICE,
      session: expiry,
      costsCentavos: 0,
      expiry,
    });
    // The real, immediate stock delivery is sized at the engine's own rebased exercise fill,
    // never the leg's nominal quantity — B3 delivers the effective (post-split) count. A factor
    // that dissolved this leg below one effective unit leaves no fill to carry over
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
  return { ok: true, fills, dissolvedTickers };
}
