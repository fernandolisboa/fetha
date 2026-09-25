import Decimal from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { DecimalString, Instant, SessionDate, Ticker } from "@fetha/contracts";
import type { Fill, Operation } from "@fetha/engine";

import {
  realizedOperation,
  type OperationFill,
  type RealizedOperationInput,
} from "./realized-operation";

let seq = 0;
function fill(overrides: Partial<OperationFill>): OperationFill {
  seq += 1;
  return {
    id: `fill-${String(seq)}`,
    ticker: "PETR4",
    assetClass: "stock",
    side: "buy",
    quantity: 100,
    price: "30" as DecimalString,
    session: "2026-09-01",
    seq,
    expiry: null,
    costsCentavos: 0,
    ...overrides,
  };
}

const PUT = "PETRV300" as Ticker;
const CALL = "PETRJ320" as Ticker;
const EXPIRY = "2026-10-16" as SessionDate;

function closeOf(session: SessionDate): Instant {
  return `${session}T20:00:00.000Z`;
}

function input(overrides: Partial<RealizedOperationInput>): RealizedOperationInput {
  return {
    id: "operation-1",
    underlying: "PETR4",
    expiry: null,
    openedAt: "2026-09-01",
    fills: [],
    heldFillIds: new Set(),
    decidedAt: "2026-09-10T15:00:00.000Z",
    decisionDate: "2026-09-10",
    horizonClose: closeOf("2026-10-16"),
    horizonDate: "2026-10-16",
    closeOf,
    rightOf: (ticker) => (ticker === PUT ? "put" : ticker === CALL ? "call" : null),
    ...overrides,
  };
}

function expectOk(result: ReturnType<typeof realizedOperation>): {
  operation: Operation;
  realizedFills: Fill[];
  settlementPending: boolean;
} {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.reason}`);
  }
  return result;
}

describe("realizedOperation", () => {
  it("scores a hold with no later fill on the position held at the decision", () => {
    const opened = fill({ quantity: 200, price: "31" as DecimalString });
    const { operation, realizedFills } = expectOk(
      realizedOperation(input({ fills: [opened], heldFillIds: new Set([opened.id]) })),
    );
    expect(operation.legs).toEqual([
      { role: "stock", side: "buy", ticker: "PETR4", quantity: 200, entryPrice: "31.000000" },
    ]);
    expect(operation.expiry).toBeNull();
    expect(operation.openedAt).toBe("2026-09-01");
    expect(realizedFills).toEqual([]);
  });

  it("turns a later closing fill into a realized fill at its session close", () => {
    const opened = fill({ quantity: 200 });
    const sold = fill({
      side: "sell",
      quantity: 150,
      price: "34" as DecimalString,
      session: "2026-09-15",
      costsCentavos: 900,
    });
    const { operation, realizedFills } = expectOk(
      realizedOperation(input({ fills: [opened, sold], heldFillIds: new Set([opened.id]) })),
    );
    expect(operation.legs).toHaveLength(1);
    expect(operation.legs[0]?.quantity).toBe(200);
    expect(realizedFills).toEqual([
      {
        ticker: "PETR4",
        side: "sell",
        quantity: 150,
        price: "34",
        session: "2026-09-15",
        at: "2026-09-15T20:00:00.000Z",
        costs: 900,
      },
    ]);
  });

  it("keeps a fill the user saw when deciding in the position even on the decision's own session", () => {
    const opened = fill({ session: "2026-09-10" });
    const { operation, realizedFills } = expectOk(
      realizedOperation(input({ fills: [opened], heldFillIds: new Set([opened.id]) })),
    );
    expect(operation.legs[0]?.quantity).toBe(100);
    expect(realizedFills).toEqual([]);
  });

  it("counts a fill recorded later but dated before the decision as part of the position", () => {
    const seen = fill({ quantity: 100, price: "30" as DecimalString });
    const earlier = fill({
      quantity: 100,
      price: "32" as DecimalString,
      session: "2026-09-05",
    });
    const { operation } = expectOk(
      realizedOperation(input({ fills: [seen, earlier], heldFillIds: new Set([seen.id]) })),
    );
    expect(operation.legs).toEqual([
      { role: "stock", side: "buy", ticker: "PETR4", quantity: 200, entryPrice: "31.000000" },
    ]);
  });

  it("places a later fill on the decision's session by whether that session closed before the decision", () => {
    const seen = fill({ quantity: 100 });
    const sameDay = fill({ side: "sell", quantity: 100, session: "2026-09-10" });

    const decidedDuringSession = expectOk(
      realizedOperation(input({ fills: [seen, sameDay], heldFillIds: new Set([seen.id]) })),
    );
    expect(decidedDuringSession.realizedFills).toHaveLength(1);

    const decidedAfterClose = realizedOperation(
      input({
        fills: [seen, sameDay],
        heldFillIds: new Set([seen.id]),
        decidedAt: "2026-09-10T23:00:00.000Z",
      }),
    );
    expect(decidedAfterClose).toEqual({ ok: false, reason: "no_position_at_decision" });
  });

  it("ignores fills after the horizon close", () => {
    const seen = fill({});
    const late = fill({ side: "sell", session: "2026-10-20" });
    const { realizedFills } = expectOk(
      realizedOperation(input({ fills: [seen, late], heldFillIds: new Set([seen.id]) })),
    );
    expect(realizedFills).toEqual([]);
  });

  it("splits a fill that crosses zero into a close and a new leg, costs pro rata", () => {
    const seen = fill({ quantity: 100, price: "30" as DecimalString });
    const flip = fill({
      side: "sell",
      quantity: 300,
      price: "33" as DecimalString,
      session: "2026-09-15",
      costsCentavos: 301,
    });
    const { operation, realizedFills } = expectOk(
      realizedOperation(input({ fills: [seen, flip], heldFillIds: new Set([seen.id]) })),
    );
    expect(realizedFills).toEqual([
      expect.objectContaining({ side: "sell", quantity: 100, price: "33", costs: 100 }),
    ]);
    expect(operation.legs).toEqual([
      { role: "stock", side: "buy", ticker: "PETR4", quantity: 100, entryPrice: "30.000000" },
      { role: "stock", side: "sell", ticker: "PETR4", quantity: 200, entryPrice: "33.000000" },
    ]);
  });

  it("realizes an assigned short put at zero and adds the delivered stock as a leg", () => {
    const soldPut = fill({
      ticker: PUT,
      assetClass: "option",
      side: "sell",
      quantity: 100,
      price: "1.20" as DecimalString,
      expiry: EXPIRY,
    });
    const closedAtZero = fill({
      ticker: PUT,
      assetClass: "option",
      side: "buy",
      quantity: 100,
      price: "0" as DecimalString,
      session: EXPIRY,
      expiry: EXPIRY,
    });
    const delivered = fill({
      side: "buy",
      quantity: 100,
      price: "30" as DecimalString,
      session: EXPIRY,
    });
    const { operation, realizedFills } = expectOk(
      realizedOperation(
        input({
          expiry: EXPIRY,
          fills: [soldPut, closedAtZero, delivered],
          heldFillIds: new Set([soldPut.id]),
        }),
      ),
    );
    expect(operation.expiry).toBe(EXPIRY);
    expect(operation.legs).toEqual([
      { role: "put", side: "sell", ticker: PUT, quantity: 100, entryPrice: "1.200000" },
      { role: "stock", side: "buy", ticker: "PETR4", quantity: 100, entryPrice: "30.000000" },
    ]);
    expect(realizedFills).toEqual([
      expect.objectContaining({ ticker: PUT, side: "buy", quantity: 100, price: "0" }),
    ]);
  });

  it("flags a settlement still pending while an option is open past its expiry", () => {
    const soldPut = fill({
      ticker: PUT,
      assetClass: "option",
      side: "sell",
      quantity: 100,
      price: "1.20" as DecimalString,
      expiry: EXPIRY,
    });
    const unconfirmed = input({
      expiry: EXPIRY,
      fills: [soldPut],
      heldFillIds: new Set([soldPut.id]),
    });
    expect(expectOk(realizedOperation(unconfirmed)).settlementPending).toBe(true);

    const beforeExpiry = {
      ...unconfirmed,
      horizonClose: closeOf("2026-10-09"),
      horizonDate: "2026-10-09",
    };
    expect(expectOk(realizedOperation(beforeExpiry)).settlementPending).toBe(false);

    const closedAtZero = fill({
      ticker: PUT,
      assetClass: "option",
      side: "buy",
      quantity: 100,
      price: "0" as DecimalString,
      session: EXPIRY,
      expiry: EXPIRY,
    });
    const confirmed = { ...unconfirmed, fills: [soldPut, closedAtZero] };
    expect(expectOk(realizedOperation(confirmed)).settlementPending).toBe(false);
  });

  it("refuses a decision with no position behind it", () => {
    const later = fill({ session: "2026-09-12" });
    expect(realizedOperation(input({ fills: [later] }))).toEqual({
      ok: false,
      reason: "no_position_at_decision",
    });
  });

  it("refuses an option leg whose series is unknown", () => {
    const seen = fill({});
    const unknown = fill({
      ticker: "PETRX999",
      assetClass: "option",
      session: "2026-09-12",
      expiry: EXPIRY,
    });
    expect(
      realizedOperation(
        input({ expiry: EXPIRY, fills: [seen, unknown], heldFillIds: new Set([seen.id]) }),
      ),
    ).toEqual({ ok: false, reason: "unknown_series" });
  });

  it("refuses a later fill whose session is not on the calendar", () => {
    const seen = fill({});
    const later = fill({ side: "sell", session: "2026-09-12" });
    expect(
      realizedOperation(
        input({ fills: [seen, later], heldFillIds: new Set([seen.id]), closeOf: () => null }),
      ),
    ).toEqual({ ok: false, reason: "unresolvable_fill_session" });
  });

  // The engine values a leg as sum((fill - entry) * sign * quantity) over its
  // closing fills plus (mark - entry) * sign * remaining; that must equal the
  // cash-flow P&L of the same fills held from the decision to the mark.
  it("preserves the cash-flow P&L of any sequence of later fills", () => {
    const later = fc.array(
      fc.record({
        side: fc.constantFrom("buy" as const, "sell" as const),
        quantity: fc.integer({ min: 1, max: 500 }),
        price: fc.integer({ min: 1, max: 200 }),
      }),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(
        fc.constantFrom("buy" as const, "sell" as const),
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 200 }),
        later,
        fc.integer({ min: 1, max: 200 }),
        (heldSide, heldQuantity, heldPrice, laterFills, mark) => {
          const seen = fill({
            side: heldSide,
            quantity: heldQuantity,
            price: String(heldPrice) as DecimalString,
          });
          const after = laterFills.map((entry, index) =>
            fill({
              side: entry.side,
              quantity: entry.quantity,
              price: String(entry.price) as DecimalString,
              session: `2026-09-${String(11 + index)}`,
            }),
          );
          const { operation, realizedFills } = expectOk(
            realizedOperation(input({ fills: [seen, ...after], heldFillIds: new Set([seen.id]) })),
          );

          const sign = (side: string) => (side === "buy" ? 1 : -1);
          let enginePnl = new Decimal(0);
          const closedByLeg = new Map<string, number>();
          for (const realized of realizedFills) {
            const leg = operation.legs.find(
              (candidate) =>
                candidate.ticker === realized.ticker && candidate.side !== realized.side,
            );
            if (!leg) throw new Error("unmatched realized fill");
            closedByLeg.set(leg.side, (closedByLeg.get(leg.side) ?? 0) + realized.quantity);
            enginePnl = enginePnl.plus(
              new Decimal(realized.price)
                .minus(leg.entryPrice)
                .times(sign(leg.side) * realized.quantity),
            );
          }
          for (const leg of operation.legs) {
            const remaining = leg.quantity - (closedByLeg.get(leg.side) ?? 0);
            expect(remaining).toBeGreaterThanOrEqual(0);
            enginePnl = enginePnl.plus(
              new Decimal(mark).minus(leg.entryPrice).times(sign(leg.side) * remaining),
            );
          }

          let cash = new Decimal(-sign(heldSide) * heldQuantity * heldPrice);
          let position = sign(heldSide) * heldQuantity;
          for (const entry of laterFills) {
            cash = cash.minus(sign(entry.side) * entry.quantity * entry.price);
            position += sign(entry.side) * entry.quantity;
          }
          const cashFlowPnl = cash.plus(position * mark);

          expect(enginePnl.minus(cashFlowPnl).abs().toNumber()).toBeLessThan(0.01);
        },
      ),
    );
  });
});
