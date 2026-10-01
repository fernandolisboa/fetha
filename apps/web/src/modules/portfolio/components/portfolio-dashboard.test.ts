import { describe, expect, it } from "vitest";
import type { DecimalString } from "@fetha/contracts";
import type { LegSettlement } from "@fetha/engine";

import type { OperationState } from "../operation-plan";
import type { OperationRecord } from "../portfolio-repository";
import type { PortfolioReadModel } from "../portfolio-service";
import { t } from "../strings";

import { corporateActionNotice, settlementLegs } from "./portfolio-dashboard";

function baseState(corporateActionNormalizationSkipped?: boolean): OperationState {
  return {
    underlying: "PETR4",
    expiry: null,
    openedAt: "2026-01-02",
    status: "open",
    closedAt: null,
    legs: [],
    corporateActionNormalizationSkipped,
  };
}

describe("corporateActionNotice", () => {
  it("returns null when not flagged", () => {
    expect(corporateActionNotice(null)).toBeNull();
    expect(corporateActionNotice(undefined)).toBeNull();
    expect(corporateActionNotice(false)).toBeNull();
  });

  it("returns the muted pt-BR notice when a corporate-action rebase was skipped", () => {
    expect(corporateActionNotice(true)).toBe(t.dashboard.operations.corporateActionNotNormalized);
  });
});

function operationRecord(): OperationRecord {
  return {
    id: "op-1",
    underlying: "PETR4",
    status: "open",
    expiry: "2026-10-16",
    openedAt: "2026-09-01",
    closedAt: null,
  };
}

function exercisedLegSettlement(overrides: Partial<LegSettlement> = {}): LegSettlement {
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
    fills: [
      {
        ticker: "PETR4",
        side: "buy",
        quantity: 2 as never,
        price: "28.00" as DecimalString,
        session: "2026-10-16",
        at: "2026-10-16T21:00:00.000Z",
        costs: 0 as never,
      },
    ],
    residualValue: 0 as never,
    ...overrides,
  } as LegSettlement;
}

function pendingSettlement(
  legs: LegSettlement[],
): PortfolioReadModel["pendingSettlements"][number] {
  return {
    operation: operationRecord(),
    state: baseState(),
    fillIds: [],
    closingQuantities: {},
    strikes: { PETR4C28: "28.00" },
    proposal: {
      operationId: "op-1",
      expiry: "2026-10-16",
      underlyingClose: "30.00" as DecimalString,
      legs,
      notes: [],
      provenance: {
        engineVersion: "0.12.0",
        pricingModel: "bsm_continuous_yield",
        truncated: [],
        dataVersion: null,
        datasetNotes: [],
      },
    },
  };
}

describe("settlementLegs (#271 review round 1 item 5)", () => {
  it("shows the engine's own rebased fill quantity and price, not the leg's nominal values", () => {
    const [view] = settlementLegs(pendingSettlement([exercisedLegSettlement()]));
    expect(view).toMatchObject({ quantity: 2, price: "28.00" });
  });

  it("falls back to the nominal leg when there is no fill (expired worthless or dissolved below one unit)", () => {
    const [view] = settlementLegs(
      pendingSettlement([exercisedLegSettlement({ fills: [], residualValue: -560 as never })]),
    );
    expect(view).toMatchObject({ quantity: 1, price: null });
  });

  it("shows an option leg's closing quantity, the count the ledger stores (#282)", () => {
    const [view] = settlementLegs({
      ...pendingSettlement([exercisedLegSettlement({ fills: [], outcome: "expired_worthless" })]),
      closingQuantities: { PETR4C28: 200 },
    });
    expect(view).toMatchObject({ quantity: 200, price: null });
  });

  it("returns no legs when a corrupt factor left no closing quantities (#282)", () => {
    expect(
      settlementLegs({ ...pendingSettlement([exercisedLegSettlement()]), closingQuantities: null }),
    ).toEqual([]);
  });

  it("returns no legs without a proposal", () => {
    expect(settlementLegs({ ...pendingSettlement([]), proposal: null })).toEqual([]);
  });
});
