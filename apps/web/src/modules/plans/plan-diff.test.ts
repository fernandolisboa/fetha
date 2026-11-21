import { describe, expect, it } from "vitest";
import type { Ticker } from "@fetha/contracts";

import { diffPlans, type PlanSnapshot } from "./plan-diff";

function snapshot(lots: number, ticker: Ticker): PlanSnapshot {
  return { lots, legs: [{ role: "call", side: "buy", ticker }] };
}

describe("diffPlans", () => {
  it("returns no changes when nothing was edited", () => {
    expect(diffPlans(snapshot(2, "PETRC100"), snapshot(2, "PETRC100"))).toEqual([]);
  });

  it("reports a lot change", () => {
    const changes = diffPlans(snapshot(2, "PETRC100"), snapshot(3, "PETRC100"));
    expect(changes).toEqual([{ kind: "lots", from: 2, to: 3 }]);
  });

  it("reports a leg's ticker change by its template position, not role and side", () => {
    const original: PlanSnapshot = {
      lots: 1,
      legs: [
        { role: "call", side: "buy", ticker: "PETRC100" },
        { role: "call", side: "sell", ticker: "PETRC110" },
      ],
    };
    const edited: PlanSnapshot = {
      lots: 1,
      legs: [
        { role: "call", side: "buy", ticker: "PETRC100" },
        { role: "call", side: "sell", ticker: "PETRC115" },
      ],
    };
    expect(diffPlans(original, edited)).toEqual([
      { kind: "leg", role: "call", side: "sell", from: "PETRC110", to: "PETRC115" },
    ]);
  });

  it("tells apart two legs sharing the same role and side by their own template position", () => {
    // A call-butterfly's two buy-call wings (ticket #380): same role, same side, same
    // strikeRank-adjacent pricing, but distinct template positions.
    const original: PlanSnapshot = {
      lots: 1,
      legs: [
        { role: "call", side: "buy", ticker: "PETRC034" },
        { role: "call", side: "sell", ticker: "PETRC036" },
        { role: "call", side: "buy", ticker: "PETRC038" },
      ],
    };
    const edited: PlanSnapshot = {
      lots: 1,
      legs: [
        { role: "call", side: "buy", ticker: "PETRC034" },
        { role: "call", side: "sell", ticker: "PETRC036" },
        { role: "call", side: "buy", ticker: "PETRC040" },
      ],
    };
    expect(diffPlans(original, edited)).toEqual([
      { kind: "leg", role: "call", side: "buy", from: "PETRC038", to: "PETRC040" },
    ]);
  });

  it("reports both a lot and a leg change together", () => {
    const changes = diffPlans(snapshot(1, "PETRC100"), snapshot(2, "PETRC105"));
    expect(changes).toEqual([
      { kind: "lots", from: 1, to: 2 },
      { kind: "leg", role: "call", side: "buy", from: "PETRC100", to: "PETRC105" },
    ]);
  });
});
