import { describe, expect, it } from "vitest";
import type { Centavos, DecimalString } from "@fetha/contracts";
import type { BacktestMetrics, EquityPoint, WalkForwardWindow } from "@fetha/engine";

import {
  alignWindows,
  compareHref,
  comparedRunIds,
  cumulativeReturns,
  MAX_COMPARED_RUNS,
  returnTone,
  runLabels,
} from "./comparison";

const d = (value: string) => value as DecimalString;
const c = (value: number) => value as Centavos;

const metrics: BacktestMetrics = {
  sessions: 2,
  operations: 0,
  totalReturn: d("0"),
  cagr: null,
  maxDrawdown: d("0"),
  sharpe: null,
  winRate: null,
  profitFactor: null,
  exposure: d("0"),
  fees: c(0),
  taxes: c(0),
  slippage: c(0),
};

function window(from: string, to: string): WalkForwardWindow {
  return { from, to, metrics };
}

describe("comparedRunIds", () => {
  it("reads one or many run ids, dropping blanks and duplicates", () => {
    expect(comparedRunIds(undefined)).toEqual([]);
    expect(comparedRunIds("a")).toEqual(["a"]);
    expect(comparedRunIds(["a", " ", "b", "a"])).toEqual(["a", "b"]);
  });

  it("keeps at most the comparison's ceiling", () => {
    expect(comparedRunIds(["a", "b", "c", "d", "e"])).toHaveLength(MAX_COMPARED_RUNS);
  });
});

describe("compareHref", () => {
  it("round-trips through comparedRunIds' query parameter", () => {
    expect(compareHref(["a", "b c"])).toBe("/estrategias/comparar?run=a&run=b+c");
  });
});

describe("returnTone", () => {
  it("maps a return's sign to its tone", () => {
    expect(returnTone(d("0.012"))).toBe("up");
    expect(returnTone(d("-0.3"))).toBe("down");
    expect(returnTone(d("0.000000"))).toBe("flat");
  });
});

describe("cumulativeReturns", () => {
  const point = (session: string, equity: number): EquityPoint => ({
    session,
    equity: c(equity),
    cash: c(equity),
    drawdown: d("0"),
  });

  it("expresses equity as a return on the run's own initial capital", () => {
    expect(
      cumulativeReturns(c(1_000_00), [point("2025-01-02", 1_100_00), point("2025-01-03", 900_00)]),
    ).toEqual([
      { session: "2025-01-02", value: 0.1 },
      { session: "2025-01-03", value: -0.1 },
    ]);
  });

  it("has no series for a non-positive initial capital", () => {
    expect(cumulativeReturns(c(0), [point("2025-01-02", 1_00)])).toEqual([]);
  });
});

describe("alignWindows", () => {
  it("lines up windows with the same bounds and leaves gaps elsewhere", () => {
    const rows = alignWindows([
      { walkForward: [window("2025-01-02", "2025-03-31"), window("2025-04-01", "2025-06-30")] },
      { walkForward: [window("2025-01-02", "2025-03-31")] },
      { walkForward: null },
    ]);
    expect(rows.map((row) => [row.from, row.cells.map((cell) => cell !== null)])).toEqual([
      ["2025-01-02", [true, true, false]],
      ["2025-04-01", [true, false, false]],
    ]);
  });

  it("orders rows by start date regardless of run order", () => {
    const rows = alignWindows([
      { walkForward: [window("2025-04-01", "2025-06-30")] },
      { walkForward: [window("2025-01-02", "2025-03-31")] },
    ]);
    expect(rows.map((row) => row.from)).toEqual(["2025-01-02", "2025-04-01"]);
  });
});

describe("runLabels", () => {
  const run = (
    id: string,
    strategyId: string,
    versionNumber: number,
    createdAt = "25/09/2026",
  ) => ({
    id,
    strategyId,
    strategyName: strategyId === "s1" ? "Trava de alta" : "Venda coberta",
    versionNumber,
    createdAt,
  });

  it("names runs of one strategy by version", () => {
    expect([...runLabels([run("a", "s1", 1), run("b", "s1", 2)]).values()]).toEqual(["v1", "v2"]);
  });

  it("names runs of different strategies by strategy and version", () => {
    expect([...runLabels([run("a", "s1", 1), run("b", "s2", 1)]).values()]).toEqual([
      "Trava de alta v1",
      "Venda coberta v1",
    ]);
  });

  it("tells two runs of the same version apart by creation date", () => {
    expect([
      ...runLabels([run("a", "s1", 2, "24/09/2026"), run("b", "s1", 2, "25/09/2026")]).values(),
    ]).toEqual(["v2 · 24/09/2026", "v2 · 25/09/2026"]);
  });
});
