import { describe, expect, it } from "vitest";
import type { OperationPricing } from "@fetha/engine";

import type { EntryPayoff } from "../entry-payoff";
import type { OperationRecord } from "../portfolio-repository";
import type { OperationRow } from "../portfolio-service";

import { openOperationPayoffs } from "./open-operation-payoffs";

const pricing = { spot: "30.000000", payoff: [], breakEvens: [] } as unknown as OperationPricing;
const priced: EntryPayoff = { kind: "priced", pricing };
const adjusted: EntryPayoff = { kind: "adjusted" };
const unpriced: EntryPayoff = { kind: "unpriced" };

function row(
  id: string,
  status: OperationRecord["status"],
  entryPayoff: EntryPayoff,
  pendingSettlement = false,
): OperationRow {
  return {
    operation: { id, underlying: `${id}4`, status, openedAt: "2026-01-02" } as OperationRecord,
    state: null,
    heldExpiry: null,
    valuation: null,
    entryPayoff,
    pendingSettlement,
  };
}

describe("openOperationPayoffs", () => {
  it("charts each open operation the engine priced at its entry prices", () => {
    const result = openOperationPayoffs([row("PETR", "open", priced)]);
    expect(result.charted).toEqual([
      { id: "PETR", underlying: "PETR4", openedAt: "2026-01-02", pricing },
    ]);
    expect(result.adjusted).toEqual([]);
    expect(result.unpriced).toEqual([]);
  });

  it("tells a corporate action apart from missing market data", () => {
    const result = openOperationPayoffs([
      row("VALE", "open", adjusted),
      row("BBAS", "open", unpriced),
    ]);
    expect(result.adjusted).toEqual(["VALE4"]);
    expect(result.unpriced).toEqual(["BBAS4"]);
  });

  it("leaves out closed, expired and settling operations", () => {
    const result = openOperationPayoffs([
      row("PETR", "closed", priced),
      row("VALE", "expired", unpriced),
      row("BBAS", "open", priced, true),
    ]);
    expect(result).toEqual({ charted: [], adjusted: [], unpriced: [] });
  });
});
