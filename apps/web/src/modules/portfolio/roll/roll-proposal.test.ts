import { describe, expect, it } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  quantitySchema,
  type DecimalString,
} from "@fetha/contracts";
import type { LegValuation } from "@fetha/engine";

import { buildRollProposal } from "./roll-proposal";

function leg(
  partial: Partial<LegValuation["leg"]> & {
    price: DecimalString | null;
    stale?: LegValuation["stale"];
  },
): LegValuation {
  const { stale, price, ...legPartial } = partial;
  return {
    leg: {
      role: "call",
      side: "buy",
      ticker: "PETR4F300",
      quantity: quantitySchema.parse(100),
      ...legPartial,
    },
    price,
    priceSource: "mid",
    stale: stale ?? null,
    fairValue: null,
    impliedVolatility: null,
    volatilitySource: null,
    greeks: null,
    timeToExpiryYears: null,
    notes: [],
  };
}

describe("buildRollProposal", () => {
  it("lists closing orders before opening orders, each with the engine's own side and price", () => {
    const proposal = buildRollProposal({
      underlying: "PETR4",
      closing: {
        // buy 100 @ 1.20 costs R$ 120.00: a debit, -12000 centavos.
        netPremium: centavosSchema.parse(-12000),
        legs: [leg({ side: "buy", ticker: "PETR4F300", price: decimalStringSchema.parse("1.20") })],
      },
      opening: {
        // sell 100 @ 4.50 brings in R$ 450.00: a credit, +45000 centavos.
        netPremium: centavosSchema.parse(45000),
        legs: [
          leg({ side: "sell", ticker: "PETR4G310", price: decimalStringSchema.parse("4.50") }),
        ],
      },
    });

    expect(proposal.orders).toEqual([
      {
        action: "close",
        ticker: "PETR4F300",
        side: "buy",
        quantity: 100,
        price: "1.20",
        stale: null,
      },
      {
        action: "open",
        ticker: "PETR4G310",
        side: "sell",
        quantity: 100,
        price: "4.50",
        stale: null,
      },
    ]);
    expect(proposal.netCreditDebitCentavos).toBe(33000);
  });

  it("nets the closing and opening cash flows into one signed credit/debit", () => {
    const proposal = buildRollProposal({
      underlying: "PETR4",
      closing: { netPremium: centavosSchema.parse(-120), legs: [] },
      opening: { netPremium: centavosSchema.parse(450), legs: [] },
    });

    expect(proposal.netCreditDebitCentavos).toBe(330);
  });

  it("nets to a debit when closing costs more than the new structure brings in", () => {
    const proposal = buildRollProposal({
      underlying: "PETR4",
      closing: { netPremium: centavosSchema.parse(-500), legs: [] },
      opening: { netPremium: centavosSchema.parse(450), legs: [] },
    });

    expect(proposal.netCreditDebitCentavos).toBe(-50);
  });

  it("carries a null price through for a leg the engine could not price", () => {
    const proposal = buildRollProposal({
      underlying: "PETR4",
      closing: {
        netPremium: centavosSchema.parse(0),
        legs: [leg({ side: "buy", ticker: "PETR4F300", price: null })],
      },
      opening: { netPremium: centavosSchema.parse(0), legs: [] },
    });

    expect(proposal.orders[0]?.price).toBeNull();
  });

  it("carries the engine's own stale flag through per order", () => {
    const proposal = buildRollProposal({
      underlying: "PETR4",
      closing: {
        netPremium: centavosSchema.parse(-12000),
        legs: [
          leg({
            side: "buy",
            ticker: "PETR4F300",
            price: decimalStringSchema.parse("1.20"),
            stale: { session: "2026-10-30" },
          }),
        ],
      },
      opening: { netPremium: centavosSchema.parse(0), legs: [] },
    });

    expect(proposal.orders[0]?.stale).toEqual({ session: "2026-10-30" });
  });
});
