import { describe, expect, it } from "vitest";
import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";
import type { CorporateActionFactor, Fill, LegSettlement } from "@fetha/engine";

import { closingQuantities, planSettlement, type LegChoice } from "./settlement-plan";

const underlying = "PETR4" as Ticker;
const openedAt = "2026-09-01" as SessionDate;
const expiry = "2026-10-16" as SessionDate;
const noActions: CorporateActionFactor[] = [];

function split(exDate: string, factor: string): CorporateActionFactor {
  return {
    ticker: underlying,
    exDate: exDate,
    asOf: `${exDate}T13:00:00.000Z` as never,
    factor: factor as DecimalString,
  };
}

function exerciseFill(overrides: Partial<Fill> = {}): Fill {
  return {
    ticker: underlying,
    side: "buy",
    quantity: 1 as never,
    price: "28.00" as DecimalString,
    session: expiry,
    at: `${expiry}T21:00:00.000Z` as never,
    costs: 0 as never,
    ...overrides,
  };
}

function exercisedLeg(overrides: Partial<LegSettlement> = {}): LegSettlement {
  return {
    leg: {
      role: "call",
      side: "buy",
      ticker: "PETR4C28",
      quantity: 1 as never,
      entryPrice: "2.50" as DecimalString,
    },
    outcome: "exercised",
    intrinsicValue: "2.00" as DecimalString,
    fills: [exerciseFill()],
    residualValue: 0 as never,
    ...overrides,
  } as LegSettlement;
}

function choice(overrides: Partial<LegChoice> = {}): LegChoice {
  return {
    ticker: "PETR4C28",
    outcome: "exercised",
    price: "28.00" as DecimalString,
    costsCentavos: 0,
    ...overrides,
  };
}

function plan(
  proposal: LegSettlement[],
  choices: LegChoice[],
  actions: CorporateActionFactor[] = noActions,
) {
  const closing = closingQuantities(openedAt, expiry, actions, proposal);
  if (!closing) throw new Error("expected closing quantities");
  return planSettlement(underlying, expiry, closing, proposal, choices);
}

describe("planSettlement (#271)", () => {
  it("sizes the stock fill at the engine's own rebased quantity, not the leg's nominal quantity", () => {
    const proposal = [
      exercisedLeg({
        leg: {
          role: "call",
          side: "buy",
          ticker: "PETR4C28",
          quantity: 1 as never,
          entryPrice: "2.50" as DecimalString,
        },
        fills: [exerciseFill({ quantity: 2 as never })],
      }),
    ];
    const result = plan(proposal, [choice()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stockFill = result.fills.find((fill) => fill.assetClass === "stock");
    expect(stockFill?.quantity).toBe(2);
    const optionFill = result.fills.find((fill) => fill.assetClass === "option");
    // #271 review round 1 item 6: the closing option fill is sized at the same rebased quantity,
    // not the leg's nominal 1 — every stored fill is read back on the "broker's own basis"
    // assumption (ADR-0021 item 1), so writing it at the nominal count would be inverse-rebased a
    // second time the next time normalization reads it.
    expect(optionFill?.quantity).toBe(2);
  });

  it("closes an expired-worthless or fully-dissolved leg at its nominal quantity (no broker-basis count to use)", () => {
    const proposal = [exercisedLeg({ fills: [], residualValue: -560 as never })];
    const result = plan(proposal, [choice()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const optionFill = result.fills.find((fill) => fill.assetClass === "option");
    expect(optionFill?.quantity).toBe(1);
  });

  it("drops the stock fill when a factor dissolved the leg below one effective unit", () => {
    const proposal = [exercisedLeg({ fills: [], residualValue: -560 as never })];
    const result = plan(proposal, [choice()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fills.filter((fill) => fill.assetClass === "stock")).toEqual([]);
    expect(result.fills).toHaveLength(1);
  });

  it("adds no stock fill for an expired-worthless leg", () => {
    const proposal = [
      exercisedLeg({
        outcome: "expired_worthless",
        intrinsicValue: "0.00" as DecimalString,
        fills: [],
      }),
    ];
    const result = plan(proposal, [
      choice({ outcome: "expired_worthless", price: "0" as DecimalString }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]?.assetClass).toBe("option");
  });

  it("refuses a choice that does not name every option leg exactly once", () => {
    const proposal = [exercisedLeg()];
    const result = plan(proposal, []);
    expect(result).toEqual({ ok: false, reason: "invalid_choice" });
  });

  it("review round 2 item 3: sizes an expired-worthless leg's closing fill on the broker basis across a split", () => {
    const proposal = [
      exercisedLeg({
        outcome: "expired_worthless",
        intrinsicValue: "0.00" as DecimalString,
        leg: {
          role: "call",
          side: "buy",
          ticker: "PETR4C28",
          quantity: 100 as never,
          entryPrice: "2.50" as DecimalString,
        },
        fills: [],
      }),
    ];
    const result = plan(
      proposal,
      [choice({ outcome: "expired_worthless", price: "0" as DecimalString })],
      [split("2026-09-15", "0.5")],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const optionFill = result.fills.find((fill) => fill.assetClass === "option");
    expect(optionFill?.quantity).toBe(200);
  });

  it("review round 2 item 3: keeps the nominal quantity when the rebase dissolves the leg below one unit", () => {
    const proposal = [
      exercisedLeg({
        outcome: "expired_worthless",
        intrinsicValue: "0.00" as DecimalString,
        leg: {
          role: "call",
          side: "buy",
          ticker: "PETR4C28",
          quantity: 1 as never,
          entryPrice: "2.50" as DecimalString,
        },
        fills: [],
      }),
    ];
    const result = plan(
      proposal,
      [choice({ outcome: "expired_worthless", price: "0" as DecimalString })],
      [split("2026-09-15", "10")],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const optionFill = result.fills.find((fill) => fill.assetClass === "option");
    expect(optionFill?.quantity).toBe(1);
  });
});

describe("closingQuantities (#282)", () => {
  function worthless(quantity: number): LegSettlement {
    return exercisedLeg({
      outcome: "expired_worthless",
      intrinsicValue: "0.00" as DecimalString,
      leg: {
        role: "call",
        side: "buy",
        ticker: "PETR4C28",
        quantity: quantity as never,
        entryPrice: "2.50" as DecimalString,
      },
      fills: [],
    });
  }

  it("rebases an expired-worthless leg onto the broker basis at expiry, the count the dialog shows", () => {
    const closing = closingQuantities(
      openedAt,
      expiry,
      [split("2026-09-15", "0.5")],
      [worthless(100)],
    );
    expect(closing?.get("PETR4C28")).toBe(200);
  });

  it("uses the engine's own delivered quantity for an exercised leg", () => {
    const closing = closingQuantities(openedAt, expiry, noActions, [
      exercisedLeg({ fills: [exerciseFill({ quantity: 2 as never })] }),
    ]);
    expect(closing?.get("PETR4C28")).toBe(2);
  });

  it("refuses a non-positive factor instead of treating it as a dissolved leg", () => {
    expect(
      closingQuantities(openedAt, expiry, [split("2026-09-15", "0")], [worthless(100)]),
    ).toBeNull();
  });

  it("refuses a factor that pushes the count past a safe integer instead of failing at the database", () => {
    expect(
      closingQuantities(
        openedAt,
        expiry,
        [split("2026-09-15", "0.000000000000001")],
        [worthless(100)],
      ),
    ).toBeNull();
  });

  it("ignores a factor ex-dated after expiry, like the engine's option window", () => {
    const closing = closingQuantities(
      openedAt,
      expiry,
      [split("2026-10-20", "0.5")],
      [worthless(100)],
    );
    expect(closing?.get("PETR4C28")).toBe(100);
  });
});
