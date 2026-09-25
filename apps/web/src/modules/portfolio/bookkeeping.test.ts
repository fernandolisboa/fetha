import Decimal from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { DecimalString } from "@fetha/contracts";

import {
  cashCentavos,
  holdingsFromFills,
  operationLegs,
  type Holding,
  type LedgerFill,
} from "./bookkeeping";

let seq = 0;
function fill(overrides: Partial<LedgerFill>): LedgerFill {
  seq += 1;
  return {
    ticker: "PETR4",
    assetClass: "stock",
    side: "buy",
    quantity: 100,
    price: "10" as DecimalString,
    session: "2026-09-01",
    seq,
    expiry: null,
    costsCentavos: 0,
    ...overrides,
  };
}

function only(holdings: Holding[]): Holding {
  const [first, ...rest] = holdings;
  if (!first || rest.length > 0) {
    throw new Error(`expected exactly one holding, got ${String(holdings.length)}`);
  }
  return first;
}

describe("holdingsFromFills", () => {
  it("averages fills in the direction of the position", () => {
    const holding = only(
      holdingsFromFills([
        fill({ price: "10" as DecimalString }),
        fill({ price: "12" as DecimalString }),
      ]),
    );
    expect(holding.position.quantity).toBe(200);
    expect(holding.position.averageCost).toBe("11.000000");
  });

  it("keeps the average when a fill reduces the position", () => {
    const holding = only(
      holdingsFromFills([
        fill({ quantity: 200, price: "11" as DecimalString }),
        fill({ side: "sell", quantity: 50, price: "20" as DecimalString }),
      ]),
    );
    expect(holding.position.quantity).toBe(150);
    expect(holding.position.averageCost).toBe("11.000000");
  });

  it("opens the opposite position at the crossing fill's price", () => {
    const holding = only(
      holdingsFromFills([
        fill({ quantity: 100, price: "11" as DecimalString }),
        fill({ side: "sell", quantity: 150, price: "13.5" as DecimalString }),
      ]),
    );
    expect(holding.position.quantity).toBe(-50);
    expect(holding.position.averageCost).toBe("13.500000");
  });

  it("omits a position that nets to zero", () => {
    expect(
      holdingsFromFills([fill({}), fill({ side: "sell", price: "15" as DecimalString })]),
    ).toEqual([]);
  });

  it("restarts the average after the position went flat", () => {
    const holding = only(
      holdingsFromFills([
        fill({ session: "2026-09-01", price: "10" as DecimalString }),
        fill({ session: "2026-09-02", side: "sell", price: "11" as DecimalString }),
        fill({ session: "2026-09-03", price: "20" as DecimalString }),
      ]),
    );
    expect(holding.position.averageCost).toBe("20.000000");
  });

  it("orders by session, then by insertion", () => {
    const later = fill({ session: "2026-09-02", side: "sell", quantity: 100 });
    const earlier = fill({ session: "2026-09-01", quantity: 100, price: "9" as DecimalString });
    const sameDayFirst = fill({
      session: "2026-09-02",
      quantity: 100,
      price: "10" as DecimalString,
    });
    sameDayFirst.seq = later.seq - 1;
    const holding = only(holdingsFromFills([later, sameDayFirst, earlier]));
    expect(holding.position.quantity).toBe(100);
    expect(holding.position.averageCost).toBe("9.500000");
  });

  it("keeps a reused option ticker apart per expiry", () => {
    const holdings = holdingsFromFills([
      fill({ ticker: "PETRJ400", assetClass: "option", side: "sell", expiry: "2025-10-17" }),
      fill({ ticker: "PETRJ400", assetClass: "option", side: "sell", expiry: "2026-10-16" }),
    ]);
    expect(holdings.map((holding) => [holding.expiry, holding.position.quantity])).toEqual([
      ["2025-10-17", -100],
      ["2026-10-16", -100],
    ]);
  });
});

describe("cashCentavos", () => {
  it("adds sells, subtracts buys and costs, rounding each fill half-up", () => {
    const cash = cashCentavos(1_000_000, [
      fill({ quantity: 3, price: "10.005" as DecimalString, costsCentavos: 50 }),
      fill({ side: "sell", quantity: 1, price: "2.5" as DecimalString, costsCentavos: 10 }),
    ]);
    expect(cash).toBe(1_000_000 - 3002 - 50 + 250 - 10);
  });
});

describe("operationLegs", () => {
  it("builds one leg per net holding with its average as entry price", () => {
    const legs = operationLegs(
      [
        fill({ quantity: 100, price: "30" as DecimalString }),
        fill({
          ticker: "PETRJ320",
          assetClass: "option",
          side: "sell",
          price: "1.2" as DecimalString,
          expiry: "2026-10-16",
        }),
      ],
      () => "call",
    );
    expect(legs).toEqual([
      { role: "stock", side: "buy", ticker: "PETR4", quantity: 100, entryPrice: "30.000000" },
      {
        role: "call",
        side: "sell",
        ticker: "PETRJ320",
        quantity: 100,
        entryPrice: "1.200000",
      },
    ]);
  });

  it("refuses an option holding without a known right", () => {
    expect(
      operationLegs(
        [fill({ ticker: "PETRJ320", assetClass: "option", expiry: "2026-10-16" })],
        () => null,
      ),
    ).toBeNull();
  });
});

const arbitraryFills = fc.array(
  fc.record({
    ticker: fc.constantFrom("PETR4", "VALE3"),
    side: fc.constantFrom("buy" as const, "sell" as const),
    quantity: fc.integer({ min: 1, max: 1000 }),
    cents: fc.integer({ min: 1, max: 100_000 }),
    day: fc.integer({ min: 1, max: 28 }),
  }),
  { maxLength: 40 },
);

function toLedger(
  rows: { ticker: string; side: "buy" | "sell"; quantity: number; cents: number; day: number }[],
): LedgerFill[] {
  return rows.map((row, index) => ({
    ticker: row.ticker,
    assetClass: "stock",
    side: row.side,
    quantity: row.quantity,
    price: new Decimal(row.cents).dividedBy(100).toFixed(2) as DecimalString,
    session: `2026-09-${String(row.day).padStart(2, "0")}`,
    seq: index + 1,
    expiry: null,
    costsCentavos: 0,
  }));
}

describe("bookkeeping properties", () => {
  it("nets each ticker to the sum of its signed quantities", () => {
    fc.assert(
      fc.property(arbitraryFills, (rows) => {
        const ledger = toLedger(rows);
        const holdings = holdingsFromFills(ledger);
        for (const ticker of ["PETR4", "VALE3"]) {
          const expected = ledger
            .filter((entry) => entry.ticker === ticker)
            .reduce((sum, entry) => sum + (entry.side === "buy" ? 1 : -1) * entry.quantity, 0);
          const actual = holdings.find((holding) => holding.ticker === ticker)?.position.quantity;
          expect(actual ?? 0).toBe(expected);
        }
      }),
    );
  });

  it("keeps the average cost within the prices that built the position", () => {
    fc.assert(
      fc.property(arbitraryFills, (rows) => {
        const ledger = toLedger(rows);
        for (const holding of holdingsFromFills(ledger)) {
          const prices = ledger
            .filter((entry) => entry.ticker === holding.ticker)
            .map((entry) => new Decimal(entry.price));
          const average = new Decimal(holding.position.averageCost);
          expect(average.gte(Decimal.min(...prices))).toBe(true);
          expect(average.lte(Decimal.max(...prices))).toBe(true);
        }
      }),
    );
  });

  it("does not depend on the order the fills are passed in", () => {
    fc.assert(
      fc.property(arbitraryFills, fc.integer(), (rows, shift) => {
        const ledger = toLedger(rows);
        const rotated =
          ledger.length === 0
            ? ledger
            : [...ledger.slice(shift % ledger.length), ...ledger.slice(0, shift % ledger.length)];
        expect(holdingsFromFills(rotated)).toEqual(holdingsFromFills(ledger));
      }),
    );
  });

  it("returns to the starting cash after a round trip at the same price", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (quantity, cents) => {
          const price = new Decimal(cents).dividedBy(10_000).toFixed(4) as DecimalString;
          const ledger = toLedger([]).concat([
            fill({ quantity, price }),
            fill({ side: "sell", quantity, price }),
          ]);
          expect(cashCentavos(500, ledger)).toBe(500);
        },
      ),
    );
  });
});
