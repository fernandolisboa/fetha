import { describe, expect, it } from "vitest";
import type { DecimalString, Quantity, SessionDate } from "@fetha/contracts";
import type { OperationLeg } from "@fetha/engine";

import { heldExpiry, type OperationState } from "./operation-plan";

const EXPIRY = "2026-10-16" as SessionDate;

function leg(role: OperationLeg["role"], ticker: string): OperationLeg {
  return {
    role,
    side: "buy",
    ticker: ticker,
    quantity: 100 as Quantity,
    entryPrice: "30" as DecimalString,
  };
}

function state(legs: OperationLeg[]): OperationState {
  return {
    underlying: "PETR4",
    expiry: EXPIRY,
    openedAt: "2026-09-01",
    status: "open",
    closedAt: null,
    legs,
  };
}

describe("heldExpiry", () => {
  it("is the shared expiry while an option leg is still open", () => {
    expect(heldExpiry(state([leg("stock", "PETR4"), leg("call", "PETRJ320")]))).toBe(EXPIRY);
  });

  it("is null for the stock left after every option leg closed (#259)", () => {
    expect(heldExpiry(state([leg("stock", "PETR4")]))).toBeNull();
  });
});
