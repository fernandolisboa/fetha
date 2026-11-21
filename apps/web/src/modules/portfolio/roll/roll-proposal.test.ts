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
  partial: Partial<LegValuation["leg"]> & { price: DecimalString | null },
): LegValuation {
  return {
    leg: {
      role: "call",
      side: "buy",
      ticker: "PETR4F300",
      quantity: quantitySchema.parse(100),
      ...partial,
    },
    price: partial.price,
    priceSource: "mid",
    stale: null,
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
        netPremium: centavosSchema.parse(-120),
        legs: [leg({ side: "buy", ticker: "PETR4F300", price: decimalStringSchema.parse("1.20") })],
      },
      opening: {
        netPremium: centavosSchema.parse(450),
        legs: [
          leg({ side: "sell", ticker: "PETR4G310", price: decimalStringSchema.parse("4.50") }),
        ],
      },
    });

    expect(proposal.orders).toEqual([
      { action: "close", ticker: "PETR4F300", side: "buy", quantity: 100, price: "1.20" },
      { action: "open", ticker: "PETR4G310", side: "sell", quantity: 100, price: "4.50" },
    ]);
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
});
