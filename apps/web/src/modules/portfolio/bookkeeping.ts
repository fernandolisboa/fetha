import Decimal from "decimal.js";
import {
  decimalStringSchema,
  quantitySchema,
  signedQuantitySchema,
  type Centavos,
  type DecimalString,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import type { OperationLeg, OptionRight, Position } from "@fetha/engine";

import type { AssetClass, FillSide } from "./schema";

export interface LedgerFill {
  ticker: Ticker;
  assetClass: AssetClass;
  side: FillSide;
  quantity: number;
  price: DecimalString;
  session: SessionDate;
  seq: number;
  expiry: SessionDate | null;
  costsCentavos: number;
}

export interface Holding {
  ticker: Ticker;
  assetClass: AssetClass;
  expiry: SessionDate | null;
  position: Position;
}

const AVERAGE_COST_SCALE = 6;

function chronological(a: LedgerFill, b: LedgerFill): number {
  return a.session === b.session ? a.seq - b.seq : a.session.localeCompare(b.session);
}

function signedQuantity(fill: LedgerFill): number {
  return fill.side === "buy" ? fill.quantity : -fill.quantity;
}

export function holdingKey(ticker: string, expiry: string | null): string {
  return `${ticker}|${expiry ?? ""}`;
}

// ADR-0021 "Average cost": moving average of the fills that opened the net
// position; a reducing fill keeps the average, a fill that crosses zero
// opens the opposite position at its own price.
export function holdingsFromFills(fills: readonly LedgerFill[]): Holding[] {
  const running = new Map<string, { fill: LedgerFill; quantity: number; averageCost: Decimal }>();
  for (const fill of [...fills].sort(chronological)) {
    const key = holdingKey(fill.ticker, fill.expiry);
    const state = running.get(key) ?? { fill, quantity: 0, averageCost: new Decimal(0) };
    const delta = signedQuantity(fill);
    const price = new Decimal(fill.price);
    const next = state.quantity + delta;
    if (state.quantity === 0 || Math.sign(state.quantity) === Math.sign(delta)) {
      state.averageCost = state.averageCost
        .times(Math.abs(state.quantity))
        .plus(price.times(Math.abs(delta)))
        .dividedBy(Math.abs(next));
    } else if (next !== 0 && Math.sign(next) !== Math.sign(state.quantity)) {
      state.averageCost = price;
    }
    state.quantity = next;
    if (next === 0) {
      state.averageCost = new Decimal(0);
    }
    running.set(key, state);
  }

  const holdings: Holding[] = [];
  for (const { fill, quantity, averageCost } of running.values()) {
    if (quantity === 0) {
      continue;
    }
    holdings.push({
      ticker: fill.ticker,
      assetClass: fill.assetClass,
      expiry: fill.expiry,
      position: {
        ticker: fill.ticker,
        quantity: signedQuantitySchema.parse(quantity),
        averageCost: decimalStringSchema.parse(
          averageCost.toDecimalPlaces(AVERAGE_COST_SCALE).toFixed(AVERAGE_COST_SCALE),
        ),
      },
    });
  }
  return holdings.sort((a, b) =>
    holdingKey(a.ticker, a.expiry).localeCompare(holdingKey(b.ticker, b.expiry)),
  );
}

// Half-up, the engine's own rounding of price × quantity to centavos.
export function fillAmountCentavos(fill: Pick<LedgerFill, "price" | "quantity">): number {
  return new Decimal(fill.price).times(fill.quantity).times(100).round().toNumber();
}

// ADR-0021 "Cash": declared capital plus every fill's cash flow.
export function cashCentavos(declaredCapital: number, fills: readonly LedgerFill[]): Centavos {
  let cash = declaredCapital;
  for (const fill of fills) {
    const amount = fillAmountCentavos(fill);
    cash += (fill.side === "sell" ? amount : -amount) - fill.costsCentavos;
  }
  return cash as Centavos;
}

export type RightOf = (holding: Holding) => OptionRight | null;

// An operation's legs are its own fills' net holdings (ADR-0021 item 4).
// Returns null when an option holding has no known right: an operation is
// only built from series the reference data knows.
export function operationLegs(
  fills: readonly LedgerFill[],
  rightOf: RightOf,
): OperationLeg[] | null {
  const legs: OperationLeg[] = [];
  for (const holding of holdingsFromFills(fills)) {
    const right = holding.assetClass === "stock" ? null : rightOf(holding);
    if (holding.assetClass === "option" && right === null) {
      return null;
    }
    const quantity = holding.position.quantity;
    legs.push({
      role: right ?? "stock",
      side: quantity > 0 ? "buy" : "sell",
      ticker: holding.ticker,
      quantity: quantitySchema.parse(Math.abs(quantity)),
      entryPrice: holding.position.averageCost,
    });
  }
  return legs;
}
