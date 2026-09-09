import { describe, expect, it } from "vitest";
import type { Centavos } from "@fetha/contracts";
import type { EquityPoint } from "../api";
import { centavos, decimalString } from "../test/support";
import { computeBacktestMetrics, MIN_ANNUALIZED_SESSIONS, sumCentavos } from "./backtest-metrics";

function point(session: string, equity: number, drawdown: string): EquityPoint {
  return {
    session,
    equity: centavos(equity),
    cash: centavos(equity),
    drawdown: decimalString(drawdown),
  };
}

describe("computeBacktestMetrics", () => {
  it("computes totalReturn, maxDrawdown, exposure, winRate and profitFactor with a short window", () => {
    const equityCurve = [
      point("2024-01-02", 110_000_00, "0.000000"),
      point("2024-01-03", 99_000_00, "0.100000"),
      point("2024-01-04", 121_000_00, "0.000000"),
    ];
    const { metrics, notes } = computeBacktestMetrics({
      equityCurve,
      initialCapital: centavos(100_000_00),
      rfPerSession: [decimalString("0"), decimalString("0"), decimalString("0")],
      held: [true, true, false],
      settledOperationPnls: [centavos(1_000_00), centavos(-500_00)],
      operationsCount: 2,
      fees: centavos(300),
      taxes: centavos(150),
      slippage: centavos(0),
    });

    expect(metrics.sessions).toBe(3);
    expect(metrics.totalReturn).toBe(decimalString("0.210000"));
    expect(metrics.maxDrawdown).toBe(decimalString("0.100000"));
    expect(metrics.exposure).toBe(decimalString("0.666667"));
    expect(metrics.winRate).toBe(decimalString("0.500000"));
    expect(metrics.profitFactor).toBe(decimalString("2.000000"));
    expect(metrics.cagr).toBeNull();
    expect(metrics.sharpe).toBeNull();
    expect(metrics.fees).toBe(centavos(300));
    expect(metrics.taxes).toBe(centavos(150));
    expect(notes).toEqual([
      {
        code: "short_window_not_annualized",
        message: `fewer than ${String(MIN_ANNUALIZED_SESSIONS)} sessions; cagr and sharpe are not annualized`,
      },
    ]);
  });

  it("returns null winRate and profitFactor when nothing settled, and null profitFactor with no losses", () => {
    const { metrics } = computeBacktestMetrics({
      equityCurve: [point("2024-01-02", 100_000_00, "0")],
      initialCapital: centavos(100_000_00),
      rfPerSession: [decimalString("0")],
      held: [false],
      settledOperationPnls: [],
      operationsCount: 0,
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    });
    expect(metrics.winRate).toBeNull();
    expect(metrics.profitFactor).toBeNull();

    const { metrics: metricsAllWins } = computeBacktestMetrics({
      equityCurve: [point("2024-01-02", 100_000_00, "0")],
      initialCapital: centavos(100_000_00),
      rfPerSession: [decimalString("0")],
      held: [false],
      settledOperationPnls: [centavos(500_00)],
      operationsCount: 1,
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    });
    expect(metricsAllWins.profitFactor).toBeNull();
  });

  it("annualizes cagr and sharpe at or above 126 sessions and null-cagrs on non-positive final equity", () => {
    const equityCurve: EquityPoint[] = [];
    for (let i = 0; i < MIN_ANNUALIZED_SESSIONS; i += 1) {
      equityCurve.push(point(`s${String(i)}`, 100_000_00 + i * 100, i === 0 ? "0" : "0"));
    }
    const rf = equityCurve.map(() => decimalString("0"));
    const { metrics, notes } = computeBacktestMetrics({
      equityCurve,
      initialCapital: centavos(100_000_00),
      rfPerSession: rf,
      held: equityCurve.map(() => true),
      settledOperationPnls: [],
      operationsCount: 0,
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    });
    expect(metrics.cagr).not.toBeNull();
    expect(metrics.sharpe).not.toBeNull();
    expect(notes).toEqual([]);

    const negativeEquityCurve = equityCurve.map((p, i) =>
      i === equityCurve.length - 1 ? { ...p, equity: centavos(-1_00) } : p,
    );
    const { metrics: negativeMetrics, notes: negativeNotes } = computeBacktestMetrics({
      equityCurve: negativeEquityCurve,
      initialCapital: centavos(100_000_00),
      rfPerSession: rf,
      held: equityCurve.map(() => true),
      settledOperationPnls: [],
      operationsCount: 0,
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    });
    expect(negativeMetrics.cagr).toBeNull();
    expect(negativeMetrics.sharpe).not.toBeNull();
    expect(negativeNotes).toEqual([
      {
        code: "non_positive_equity",
        message: "final equity is non-positive; cagr has no real value",
      },
    ]);
  });

  it("returns a null sharpe when excess returns never vary (zero standard deviation)", () => {
    const equityCurve = [
      point("2024-01-02", 100_000_00, "0"),
      point("2024-01-03", 100_000_00, "0"),
    ];
    const { metrics } = computeBacktestMetrics({
      equityCurve,
      initialCapital: centavos(100_000_00),
      rfPerSession: [decimalString("0"), decimalString("0")],
      held: [false, false],
      settledOperationPnls: [],
      operationsCount: 0,
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    });
    expect(metrics.sharpe).toBeNull();
  });

  it("reports zero exposure and zero totalReturn on an empty equity curve", () => {
    const { metrics } = computeBacktestMetrics({
      equityCurve: [],
      initialCapital: centavos(100_000_00),
      rfPerSession: [],
      held: [],
      settledOperationPnls: [],
      operationsCount: 0,
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    });
    expect(metrics.sessions).toBe(0);
    expect(metrics.exposure).toBe(decimalString("0.000000"));
    expect(metrics.totalReturn).toBe(decimalString("0.000000"));
  });

  it("guards every ratio against a zero initial capital instead of dividing by zero", () => {
    const { metrics } = computeBacktestMetrics({
      equityCurve: [point("2024-01-02", 0, "0"), point("2024-01-03", 0, "0")],
      initialCapital: centavos(0),
      rfPerSession: [decimalString("0"), decimalString("0")],
      held: [false, false],
      settledOperationPnls: [],
      operationsCount: 0,
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    });
    expect(metrics.totalReturn).toBe(decimalString("0.000000"));
  });
});

describe("sumCentavos", () => {
  it("sums a list of centavos into one integer centavos value", () => {
    const values: Centavos[] = [centavos(100), centavos(200), centavos(-50)];
    expect(sumCentavos(values)).toBe(centavos(250));
  });
});
