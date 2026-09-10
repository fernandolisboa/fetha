import Decimal from "decimal.js";
import type { Instant, SessionDate, Ticker } from "@fetha/contracts";
import type {
  EngineError,
  Fill,
  LegSettlement,
  MarketView,
  Operation,
  OperationLeg,
  ProposeSettlementInput,
  Provenance,
  Result,
  SettlementProposal,
  Side,
} from "../api";
import { sessionByDate } from "./calendar";
import { PRICE_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { validateOperationCoherence } from "./operation-coherence";
import { resolveSeries } from "./resolve-series";
import { toCentavos } from "./scalars";
import { latestVisible } from "./visible";

type ProvenanceBase = Pick<
  Provenance,
  "engineVersion" | "pricingModel" | "dataVersion" | "datasetNotes"
>;

function invalidInput(path: string, message: string): EngineError {
  return { code: "invalid_input", path, message };
}

function err(error: EngineError): Result<SettlementProposal> {
  return { ok: false, error };
}

// A `SessionDate` alone (no candle asOf, no session close) is what `insufficient_data` has to
// report when the calendar does not cover the expiry session at all: there is no real Instant
// to name yet, since resolving one is exactly what is missing. A midnight-UTC instant on that
// date is informational only (never fed back into a computation) and tells the caller which
// day to fetch (ADR-0013 #25 addendum).
function sessionDateToInstant(date: SessionDate): Instant {
  return `${date}T00:00:00.000Z`;
}

function insufficientCandles(underlying: Ticker, session: SessionDate): EngineError {
  const at = sessionDateToInstant(session);
  return {
    code: "insufficient_data",
    needed: {
      from: at,
      to: at,
      instruments: [underlying],
      timeframes: ["D1"],
      collections: ["candles"],
    },
  };
}

function settleLeg(
  leg: OperationLeg,
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
  const operation: Operation = input.operation;
  if (operation.expiry === null) {
    return err(
      invalidInput("operation.expiry", "an operation with no expiry has nothing to settle"),
    );
  }

  const session = sessionByDate(input.view.calendar, operation.expiry);
  if (!session) return err(insufficientCandles(operation.underlying, operation.expiry));
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
  if (!underlyingCandle) return err(insufficientCandles(operation.underlying, operation.expiry));

  const underlyingClose = underlyingCandle.close;
  const closeDecimal = parseDecimal(underlyingClose);

  const legs: LegSettlement[] = [];
  for (const leg of operation.legs) {
    const settled = settleLeg(
      leg,
      operation.underlying,
      closeDecimal,
      operation.expiry,
      expiryClose,
      input.view,
    );
    if (!settled.ok) return err(settled.error);
    legs.push(settled.value);
  }

  return {
    ok: true,
    value: {
      operationId: operation.id,
      expiry: operation.expiry,
      underlyingClose,
      legs,
      notes: [],
      provenance: { ...provenanceBase, truncated: [] },
    },
  };
}
