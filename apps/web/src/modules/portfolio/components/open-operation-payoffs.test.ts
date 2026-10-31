import { describe, expect, it } from "vitest";
import type { OperationPricing } from "@fetha/engine";

import type { OperationRecord } from "../portfolio-repository";
import type { OperationRow } from "../portfolio-service";

import { openOperationPayoffs } from "./open-operation-payoffs";

const pricing = { spot: "30.000000", payoff: [], breakEvens: [] } as unknown as OperationPricing;

function row(
  id: string,
  status: OperationRecord["status"],
  entryPayoff: OperationPricing | null,
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
    const result = openOperationPayoffs([row("PETR", "open", pricing)]);
    expect(result.charted).toEqual([
      { id: "PETR", underlying: "PETR4", openedAt: "2026-01-02", pricing },
    ]);
    expect(result.uncharted).toEqual([]);
  });

  it("names the open operations left without a chart", () => {
    expect(openOperationPayoffs([row("VALE", "open", null)]).uncharted).toEqual(["VALE4"]);
  });

  it("leaves out closed, expired and settling operations", () => {
    const result = openOperationPayoffs([
      row("PETR", "closed", pricing),
      row("VALE", "expired", null),
      row("BBAS", "open", pricing, true),
    ]);
    expect(result).toEqual({ charted: [], uncharted: [] });
  });
});
