import Decimal from "decimal.js";
import {
  centavosSchema,
  decimalStringSchema,
  quantitySchema,
  type Instant,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import type { Fill, Operation, OperationLeg, OptionRight, Side } from "@fetha/engine";

import { chronological, operationLegs, type LedgerFill } from "./bookkeeping";

const ENTRY_PRICE_SCALE = 6;

export interface OperationFill extends LedgerFill {
  id: string;
}

export interface RealizedOperationInput {
  id: string;
  underlying: Ticker;
  expiry: SessionDate | null;
  openedAt: SessionDate;
  fills: readonly OperationFill[];
  heldFillIds: ReadonlySet<string>;
  decidedAt: Instant;
  decisionDate: SessionDate;
  horizonClose: Instant;
  horizonDate: SessionDate;
  closeOf: (session: SessionDate) => Instant | null;
  rightOf: (ticker: Ticker, expiry: SessionDate | null) => OptionRight | null;
}

export type RealizedOperationRefusal =
  "no_position_at_decision" | "unknown_series" | "unresolvable_fill_session";

export type RealizedOperationResult =
  | { ok: true; operation: Operation; realizedFills: Fill[]; settlementPending: boolean }
  | { ok: false; reason: RealizedOperationRefusal };

interface LegState {
  role: OperationLeg["role"];
  side: Side;
  ticker: Ticker;
  quantity: number;
  cost: Decimal;
}

function legKey(ticker: string, side: Side): string {
  return `${ticker}|${side}`;
}

// ADR-0022 item 4: the position a held-operation decision was taken on, and
// every fill of that operation between the decision and the horizon close.
// A fill the user saw in the operation when deciding is part of the
// position; a fill recorded later belongs to the position when its session
// closed at or before the decision, and is a response to the decision
// otherwise. A later fill closes the open side of its ticker first (a
// realized fill for the engine, its costs pro rata) and any excess opens or
// adds to that side, merged into one leg per ticker and side at the
// weighted average price, which leaves the P&L unchanged because the P&L
// of a leg is linear in its fills.
export function realizedOperation(input: RealizedOperationInput): RealizedOperationResult {
  const held: OperationFill[] = [];
  const later: { fill: OperationFill; at: Instant }[] = [];
  for (const fill of [...input.fills].sort(chronological)) {
    if (input.heldFillIds.has(fill.id) || fill.session < input.decisionDate) {
      held.push(fill);
      continue;
    }
    const closesAt = input.closeOf(fill.session);
    if (closesAt === null) {
      return { ok: false, reason: "unresolvable_fill_session" };
    }
    if (new Date(closesAt) <= new Date(input.decidedAt)) {
      held.push(fill);
    } else if (new Date(closesAt) <= new Date(input.horizonClose)) {
      later.push({ fill, at: closesAt });
    }
  }

  const heldLegs = operationLegs(held, (holding) =>
    holding.assetClass === "option" ? input.rightOf(holding.ticker, holding.expiry) : null,
  );
  if (heldLegs === null) {
    return { ok: false, reason: "unknown_series" };
  }
  if (heldLegs.length === 0) {
    return { ok: false, reason: "no_position_at_decision" };
  }

  const legs = new Map<string, LegState>();
  const net = new Map<string, number>();
  for (const leg of heldLegs) {
    legs.set(legKey(leg.ticker, leg.side), {
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      quantity: leg.quantity,
      cost: new Decimal(leg.entryPrice).times(leg.quantity),
    });
    const quantity: number = leg.quantity;
    net.set(leg.ticker, leg.side === "buy" ? quantity : -quantity);
  }

  const realizedFills: Fill[] = [];
  for (const { fill, at } of later) {
    const role = fill.assetClass === "stock" ? "stock" : input.rightOf(fill.ticker, fill.expiry);
    if (role === null) {
      return { ok: false, reason: "unknown_series" };
    }
    const position = net.get(fill.ticker) ?? 0;
    const delta = fill.side === "buy" ? fill.quantity : -fill.quantity;
    const closing =
      position !== 0 && Math.sign(position) !== Math.sign(delta)
        ? Math.min(Math.abs(position), fill.quantity)
        : 0;
    if (closing > 0) {
      realizedFills.push({
        ticker: fill.ticker,
        side: fill.side,
        quantity: quantitySchema.parse(closing),
        price: fill.price,
        session: fill.session,
        at,
        costs: centavosSchema.parse(
          new Decimal(fill.costsCentavos)
            .times(closing)
            .dividedBy(fill.quantity)
            .round()
            .toNumber(),
        ),
      });
    }
    const opening = fill.quantity - closing;
    if (opening > 0) {
      const key = legKey(fill.ticker, fill.side);
      const leg = legs.get(key) ?? {
        role,
        side: fill.side,
        ticker: fill.ticker,
        quantity: 0,
        cost: new Decimal(0),
      };
      leg.quantity += opening;
      leg.cost = leg.cost.plus(new Decimal(fill.price).times(opening));
      legs.set(key, leg);
    }
    net.set(fill.ticker, position + delta);
  }

  const operationLegsOut: OperationLeg[] = [...legs.values()].map((leg) => ({
    role: leg.role,
    side: leg.side,
    ticker: leg.ticker,
    quantity: quantitySchema.parse(leg.quantity),
    entryPrice: decimalStringSchema.parse(
      leg.cost
        .dividedBy(leg.quantity)
        .toDecimalPlaces(ENTRY_PRICE_SCALE)
        .toFixed(ENTRY_PRICE_SCALE),
    ),
  }));

  const hasOptionLeg = operationLegsOut.some((leg) => leg.role !== "stock");
  if (hasOptionLeg && input.expiry === null) {
    return { ok: false, reason: "unknown_series" };
  }
  // An option still open once its expiry is inside the horizon means the
  // user has not confirmed the settlement yet (ADR-0022 item 4).
  const optionOpen = operationLegsOut.some(
    (leg) => leg.role !== "stock" && (net.get(leg.ticker) ?? 0) !== 0,
  );
  const settlementPending =
    optionOpen && input.expiry !== null && input.expiry <= input.horizonDate;
  return {
    ok: true,
    operation: {
      id: input.id,
      underlying: input.underlying,
      legs: operationLegsOut,
      expiry: hasOptionLeg ? input.expiry : null,
      openedAt: input.openedAt,
      strategyVersionId: null,
      rolledFrom: null,
    },
    realizedFills,
    settlementPending,
  };
}
