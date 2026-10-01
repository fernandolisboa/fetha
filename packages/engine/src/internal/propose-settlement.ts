import Decimal from "decimal.js";
import type { Centavos, Instant, Quantity, SessionDate, Ticker } from "@fetha/contracts";
import type {
  EngineError,
  Fill,
  LegSettlement,
  MarketView,
  Note,
  Operation,
  OperationLeg,
  ProposeSettlementInput,
  Result,
  SettlementProposal,
  Side,
  TradingSession,
} from "../api";
import { PRICE_SCALE, parseDecimal, toDecimalString, toDecimalStringAtLeastScale } from "./decimal";
import { invalidInput } from "./errors";
import { grossCentavos } from "./fill-pricing";
import { isAtOrBefore } from "./instant";
import { validateOperationCoherence } from "./operation-coherence";
import { resolveOptionStrike, type OptionStrikeAdjustment } from "./option-strike";
import { OPTION_STRIKE_DERIVED_NOTE, OPTION_STRIKE_UNCONFIRMED_NOTE } from "./notes";
import type { ProvenanceBase } from "./provenance";
import { resolveExpiryClose } from "./resolve-expiry-close";
import { toCentavos, toQuantity } from "./scalars";
import { splitFactorProduct } from "./split-factor";
import { validateViewIntegrity } from "./validate-view-integrity";
import { latestVisible } from "./visible";

function err(error: EngineError): Result<SettlementProposal> {
  return { ok: false, error };
}

// The calendar-gap case (no `TradingSession` at all for the expiry date) is `resolveExpiryClose`
// (shared with markToMarket). Distinct from `insufficientCandlesForSession`
// below, whose calendar coverage gives a real open/close window instead of
// the midnight-UTC placeholder a calendar gap has to fall back on.
function insufficientCandlesForSession(underlying: Ticker, session: TradingSession): EngineError {
  return {
    code: "insufficient_data",
    needed: {
      from: session.open,
      to: session.close,
      instruments: [underlying],
      timeframes: ["D1"],
      collections: ["candles"],
    },
  };
}

// ADR-0014 Q41's exercise/assignment decision, shared with runBacktest (#72). Its fill is
// cost-free; a caller with a cost model charges it on the fill itself.
export function settleLeg(
  leg: OperationLeg,
  legIndex: number,
  underlying: Ticker,
  underlyingClose: Decimal,
  session: SessionDate,
  at: Instant,
  view: MarketView,
):
  | { ok: true; value: LegSettlement; adjustment: OptionStrikeAdjustment }
  | { ok: false; error: EngineError } {
  if (leg.role === "stock") {
    return {
      ok: true,
      value: {
        leg: { ...leg, role: "stock" },
        outcome: "kept",
        intrinsicValue: null,
        fills: [],
        residualValue: toCentavos(0),
      },
      adjustment: "none",
    };
  }

  const resolved = resolveOptionStrike(view, leg.ticker, underlying, session, at);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { series, strike: strikeString, adjustment } = resolved.value;
  if (!parseDecimal(strikeString).gt(0)) {
    return {
      ok: false,
      error: invalidInput(
        `legs[${String(legIndex)}].strike`,
        `a listed strike must be positive (${series.ticker})`,
      ),
    };
  }

  const strike = parseDecimal(strikeString);
  const intrinsic =
    leg.role === "call"
      ? Decimal.max(underlyingClose.sub(strike), 0)
      : Decimal.max(strike.sub(underlyingClose), 0);
  const inTheMoney = intrinsic.gt(0);
  const intrinsicValue = toDecimalString(intrinsic, PRICE_SCALE);

  // B3's automatic exercise mirrors ADR-0014 Q41: exercise buys the underlying for a long
  // call and sells it for a long put; assignment is the writer's mirror image.
  const fillSide: Side =
    leg.side === "buy"
      ? leg.role === "call"
        ? "buy"
        : "sell"
      : leg.role === "call"
        ? "sell"
        : "buy";
  const fills: Fill[] = inTheMoney
    ? [
        {
          ticker: underlying,
          side: fillSide,
          quantity: leg.quantity,
          price: toDecimalStringAtLeastScale(strike, PRICE_SCALE),
          session,
          at,
          costs: toCentavos(0),
        },
      ]
    : [];

  if (leg.side === "buy") {
    return {
      ok: true,
      value: {
        leg: {
          role: leg.role,
          side: leg.side,
          ticker: leg.ticker,
          quantity: leg.quantity,
          entryPrice: leg.entryPrice,
        },
        outcome: inTheMoney ? "exercised" : "expired_worthless",
        intrinsicValue,
        fills,
        residualValue: toCentavos(0),
      },
      adjustment,
    };
  }
  return {
    ok: true,
    value: {
      leg: {
        role: leg.role,
        side: leg.side,
        ticker: leg.ticker,
        quantity: leg.quantity,
        entryPrice: leg.entryPrice,
      },
      outcome: inTheMoney ? "assigned" : "expired_worthless",
      intrinsicValue,
      fills,
      residualValue: toCentavos(0),
    },
    adjustment,
  };
}

// #271: `settleLeg` reports the exercise/assignment fill at the leg's nominal `quantity`, the
// count the operation's own ledger was opened with; the real, immediate trade B3 settles only
// ever moves a whole number of shares at the effective (post-split) count. Shared by
// `proposeSettlement` and `runBacktest`'s own expiry handling (#72) so neither drifts from the
// other: a corporate-action factor that does not evenly divide `leg.quantity` leaves a
// fractional unit that can never actually trade, cash-settled into `residualValue` at this same
// fill's price rather than rounded away (mirroring a stock leg's own split-residue handling,
// ADR-0014 Q51).
export function rebaseExerciseFillUnits(
  fill: Pick<Fill, "price" | "side">,
  effectiveQuantity: Decimal,
  path: string,
):
  | { ok: true; value: { quantity: Quantity | null; residualValue: Centavos } }
  | { ok: false; error: EngineError } {
  const effectiveUnits = Math.floor(effectiveQuantity.toNumber());
  if (effectiveUnits > 0 && !Number.isSafeInteger(effectiveUnits)) {
    return {
      ok: false,
      error: invalidInput(
        path,
        "a corporate-action factor produces a non-integer-safe effective quantity for this leg",
      ),
    };
  }
  const residue = effectiveQuantity.sub(effectiveUnits);
  const residualValueCentavos = residue.isPositive()
    ? grossCentavos(fill.price, residue).round().toNumber()
    : 0;
  return {
    ok: true,
    value: {
      quantity: effectiveUnits > 0 ? toQuantity(effectiveUnits) : null,
      residualValue: toCentavos(
        residualValueCentavos === 0 ? 0 : (fill.side === "sell" ? 1 : -1) * residualValueCentavos,
      ),
    },
  };
}

export function proposeSettlement(
  input: ProposeSettlementInput,
  provenanceBase: ProvenanceBase,
): Result<SettlementProposal> {
  const viewIntegrityError = validateViewIntegrity(input.view);
  if (viewIntegrityError) return err(viewIntegrityError);

  const operation: Operation = input.operation;
  if (operation.expiry === null) {
    return err(
      invalidInput("operation.expiry", "an operation with no expiry has nothing to settle"),
    );
  }

  const expiryCloseResult = resolveExpiryClose(input.view, operation);
  if (!expiryCloseResult.ok) return err(expiryCloseResult.error);
  const session = expiryCloseResult.session;
  const expiryClose = session.close;

  const coherenceError = validateOperationCoherence(
    input.view,
    operation,
    expiryClose,
    "operation",
  );
  if (coherenceError) return err(coherenceError);

  // `latestVisible` (asOf <= expiryClose, latest wins) rather than the first array match:
  // MarketView.candles order is not meaningful (I3), so a same-session candle revision must
  // resolve the same way regardless of array order, and a revision published after the
  // expiry close must stay invisible to this call (I1).
  const underlyingCandle = latestVisible(
    input.view.candles.filter(
      (c) =>
        c.ticker === operation.underlying && c.timeframe === "D1" && c.session === operation.expiry,
    ),
    expiryClose,
  );
  if (!underlyingCandle) return err(insufficientCandlesForSession(operation.underlying, session));

  const underlyingClose = underlyingCandle.close;
  const closeDecimal = parseDecimal(underlyingClose);

  const legs: LegSettlement[] = [];
  let anyStrikeDerived = false;
  let anyStrikeUnconfirmed = false;
  let anyLessThanOneUnit = false;
  for (const [legIndex, leg] of operation.legs.entries()) {
    const settled = settleLeg(
      leg,
      legIndex,
      operation.underlying,
      closeDecimal,
      operation.expiry,
      expiryClose,
      input.view,
    );
    if (!settled.ok) return err(settled.error);
    if (settled.adjustment === "derived") anyStrikeDerived = true;
    if (settled.adjustment === "unconfirmed") anyStrikeUnconfirmed = true;

    const bareFill = settled.value.fills[0];
    if (!bareFill) {
      legs.push(settled.value);
      continue;
    }

    // #271: the exercise/assignment fill settleLeg reports is at the leg's nominal `quantity`;
    // B3 delivers the effective (post-split) count. The factor is the same window
    // mark-to-market and score rebase an option leg through: every factor visible by the
    // expiry close, between the operation's own `openedAt` and the leg's own expiry (an option
    // leg never outlives it).
    const visibleFactors = input.view.corporateActions.filter(
      (f) => f.ticker === operation.underlying && isAtOrBefore(f.asOf, expiryClose),
    );
    const factorResult = splitFactorProduct(visibleFactors, operation.openedAt, operation.expiry);
    if (!factorResult.ok) return err(factorResult.error);
    const effectiveQuantity = new Decimal(leg.quantity).div(factorResult.value);
    const rebased = rebaseExerciseFillUnits(
      bareFill,
      effectiveQuantity,
      `operation.legs[${String(legIndex)}]`,
    );
    if (!rebased.ok) return err(rebased.error);
    if (rebased.value.quantity === null) {
      anyLessThanOneUnit = true;
      legs.push({ ...settled.value, fills: [], residualValue: rebased.value.residualValue });
    } else {
      legs.push({
        ...settled.value,
        fills: [{ ...bareFill, quantity: rebased.value.quantity }],
        residualValue: rebased.value.residualValue,
      });
    }
  }

  // A settlement proposal is not itself a trade (ADR-0013 #25 addendum): the one fill a
  // non-worthless leg implies carries zero costs, since no B3 fee or brokerage applies until
  // the user confirms it. Note that plainly whenever at least one leg actually proposes a
  // fill, so the zero is never read as "this trade is free."
  const notes: Note[] = legs.some((l) => l.fills.length > 0)
    ? [
        {
          code: "settlement_costs_not_modeled",
          message: "the proposed fill(s) carry no B3 fee or brokerage; costs apply once recorded",
        },
      ]
    : [];
  // #69 part 2, at least one option leg's strike had a factor ex-dated
  // exactly on the settlement session itself, applied with confidence since that session's own
  // epoch cannot exist yet (option-strike.ts). this must be the
  // exact same `Note` object `score.ts`'s own forwarding uses (`buildEntryPricedLegs`), or its
  // dedup-by-code-and-message guard cannot recognize the two as the same note and a settled
  // operation reads it twice.
  if (anyStrikeDerived) notes.push(OPTION_STRIKE_DERIVED_NOTE);
  // At least one option leg's strike had a factor ex-dated earlier still, with no epoch of its
  // own confirming it reflects the strike above: this could be a genuine ingestion gap or an
  // already-correct, early-dated epoch (ADR-0056 backfill step 2) — indistinguishable from here,
  // so the strike is kept as read and flagged rather than guessed either way.
  if (anyStrikeUnconfirmed) notes.push(OPTION_STRIKE_UNCONFIRMED_NOTE);
  // #271: a corporate-action factor leaving at least one leg with less than one effective unit
  // to actually exercise or assign; its value is folded into that leg's own `residualValue`
  // instead of a fill that never happened (mirroring mark-to-market's own note of the same
  // code).
  if (anyLessThanOneUnit) {
    notes.push({
      code: "less_than_one_effective_unit",
      message:
        "a corporate-action factor leaves at least one leg with less than one effective unit to settle; its residual value is folded into residualValue instead of a fill",
    });
  }

  return {
    ok: true,
    value: {
      operationId: operation.id,
      expiry: operation.expiry,
      underlyingClose,
      legs,
      notes,
      provenance: { ...provenanceBase, truncated: [] },
    },
  };
}
