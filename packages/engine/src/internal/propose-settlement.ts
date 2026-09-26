import Decimal from "decimal.js";
import type { Instant, SessionDate, Ticker } from "@fetha/contracts";
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
import { PRICE_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { invalidInput } from "./errors";
import { validateOperationCoherence } from "./operation-coherence";
import type { ProvenanceBase } from "./provenance";
import { resolveExpiryClose } from "./resolve-expiry-close";
import { resolveSeries } from "./resolve-series";
import { toCentavos } from "./scalars";
import { validateViewIntegrity } from "./validate-view-integrity";
import { latestVisible } from "./visible";

function err(error: EngineError): Result<SettlementProposal> {
  return { ok: false, error };
}

// The calendar-gap case (no `TradingSession` at all for the expiry date) is `resolveExpiryClose`
// (round 3 item 10, shared with markToMarket). Distinct from `insufficientCandlesForSession`
// below, whose calendar coverage gives a real open/close window (round 1 item 10) instead of
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
): { ok: true; value: LegSettlement } | { ok: false; error: EngineError } {
  if (leg.role === "stock") {
    return {
      ok: true,
      value: { leg: { ...leg, role: "stock" }, outcome: "kept", intrinsicValue: null, fills: [] },
    };
  }

  const series = resolveSeries(view, leg.ticker, at);
  if (!series) return { ok: false, error: { code: "missing_instrument", ticker: leg.ticker } };
  if (!parseDecimal(series.strike).gt(0)) {
    return {
      ok: false,
      error: invalidInput(`legs[${String(legIndex)}].strike`, "a listed strike must be positive"),
    };
  }

  const strike = parseDecimal(series.strike);
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
          price: toDecimalString(strike, PRICE_SCALE),
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
      },
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
    legs.push(settled.value);
  }

  // A settlement proposal is not itself a trade (ADR-0013 #25 addendum): the one fill a
  // non-worthless leg implies carries zero costs, since no B3 fee or brokerage applies until
  // the user confirms it. Note that plainly whenever at least one leg actually proposes a
  // fill (round 1 item 10), so the zero is never read as "this trade is free."
  const notes: Note[] = legs.some((l) => l.fills.length > 0)
    ? [
        {
          code: "settlement_costs_not_modeled",
          message: "the proposed fill(s) carry no B3 fee or brokerage; costs apply once recorded",
        },
      ]
    : [];

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
