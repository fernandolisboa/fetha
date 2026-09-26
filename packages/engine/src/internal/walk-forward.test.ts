import { describe, expect, it } from "vitest";
import type { MonthlyTax } from "../api";
import { centavos, decimalString } from "../test/support";
import { computeWalkForward, type WalkForwardInput } from "./walk-forward";

function tax(month: string, amount: number): MonthlyTax {
  return {
    month,
    stockSales: centavos(0),
    stockGain: centavos(0),
    optionGain: centavos(0),
    exemptGain: centavos(0),
    netGain: centavos(0),
    tax: centavos(amount),
  };
}

function input(
  sessions: string[],
  equities: number[],
  overrides: Partial<WalkForwardInput> = {},
): WalkForwardInput {
  let peak = 100_000_00;
  return {
    windowSessions: 2,
    periodSessions: sessions,
    initialCapital: centavos(100_000_00),
    equityCurve: sessions.map((session, i) => {
      const equity = equities[i] ?? 0;
      peak = Math.max(peak, equity);
      return {
        session,
        equity: centavos(equity),
        cash: centavos(equity),
        drawdown: decimalString((1 - equity / peak).toFixed(6)),
      };
    }),
    rfPerSession: sessions.map(() => decimalString("0")),
    held: sessions.map(() => false),
    operations: [],
    fills: [],
    taxes: [],
    slippageEntries: [],
    ...overrides,
  };
}

describe("computeWalkForward", () => {
  it("cuts the period into consecutive windows, the last one shorter", () => {
    const windows = computeWalkForward(
      input(["2024-01-02", "2024-01-03", "2024-01-04"], [100_000_00, 100_000_00, 100_000_00]),
    );
    expect(windows.map((w) => [w.from, w.to, w.metrics.sessions])).toEqual([
      ["2024-01-02", "2024-01-03", 2],
      ["2024-01-04", "2024-01-04", 1],
    ]);
  });

  it("measures each window's return from the previous window's ending equity", () => {
    const windows = computeWalkForward(
      input(
        ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"],
        [90_000_00, 80_000_00, 84_000_00, 88_000_00],
      ),
    );
    expect(windows[0]?.metrics.totalReturn).toBe(decimalString("-0.200000"));
    expect(windows[1]?.metrics.totalReturn).toBe(decimalString("0.100000"));
  });

  it("measures a window's drawdown from its own starting equity, not the run's earlier peak", () => {
    // Window 2 only rises from its own start (80k -> 84k -> 88k): the run is still 12% under its
    // 100k peak there, but nothing inside window 2 fell, so its own max drawdown is zero.
    const windows = computeWalkForward(
      input(
        ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"],
        [90_000_00, 80_000_00, 84_000_00, 88_000_00],
      ),
    );
    expect(windows[0]?.metrics.maxDrawdown).toBe(decimalString("0.200000"));
    expect(windows[1]?.metrics.maxDrawdown).toBe(decimalString("0.000000"));
  });

  it("measures a fall inside a window against the window's own running peak", () => {
    const windows = computeWalkForward(
      input(
        ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"],
        [80_000_00, 80_000_00, 100_000_00, 90_000_00],
      ),
    );
    expect(windows[1]?.metrics.maxDrawdown).toBe(decimalString("0.100000"));
  });

  it("reports no drawdown while a window's running peak is not positive", () => {
    const windows = computeWalkForward(
      input(["2024-01-02", "2024-01-03", "2024-01-04"], [-5_00, -10_00, -20_00], {
        windowSessions: 1,
      }),
    );
    expect(windows[1]?.metrics.maxDrawdown).toBe(decimalString("0.000000"));
    expect(windows[2]?.metrics.maxDrawdown).toBe(decimalString("0.000000"));
  });

  it("attributes a month's tax to exactly one window, the one holding that month's last session", () => {
    // January's last period session (01-31) is in window 2; a month cut by a window boundary is
    // never counted in both windows.
    const windows = computeWalkForward(
      input(
        ["2024-01-29", "2024-01-30", "2024-01-31", "2024-02-01"],
        [100_000_00, 100_000_00, 100_000_00, 100_000_00],
        { taxes: [tax("2024-01", 150), tax("2024-02", 70)] },
      ),
    );
    expect(windows.map((w) => w.metrics.taxes)).toEqual([centavos(0), centavos(220)]);
  });

  it("partitions fees, slippage and taxes so the windows sum to the whole run", () => {
    const windows = computeWalkForward(
      input(
        ["2024-01-30", "2024-01-31", "2024-02-01", "2024-02-02", "2024-02-05"],
        [100_000_00, 100_000_00, 100_000_00, 100_000_00, 100_000_00],
        {
          taxes: [tax("2024-01", 150), tax("2024-02", 70)],
          slippageEntries: [
            { session: "2024-01-31", amount: centavos(5) },
            { session: "2024-02-01", amount: centavos(7) },
          ],
        },
      ),
    );
    expect(windows.reduce((sum, w) => sum + w.metrics.taxes, 0)).toBe(220);
    expect(windows.reduce((sum, w) => sum + w.metrics.slippage, 0)).toBe(12);
    expect(windows.map((w) => w.metrics.taxes)).toEqual([centavos(150), centavos(0), centavos(70)]);
  });
});
