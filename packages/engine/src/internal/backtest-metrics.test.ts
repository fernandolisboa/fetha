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
    expect(negativeMetrics.sharpe).toBeNull();
    expect(negativeNotes).toEqual([
      {
        code: "non_positive_equity",
        message: "final equity is non-positive; cagr has no real value",
      },
    ]);
  });

  it("nulls sharpe (but not cagr) on a non-positive equity point strictly inside the window", () => {
    const equityCurve: EquityPoint[] = [];
    for (let i = 0; i < MIN_ANNUALIZED_SESSIONS; i += 1) {
      equityCurve.push(point(`s${String(i)}`, 100_000_00 + i * 100, "0"));
    }
    const dippedEquityCurve = equityCurve.map((p, i) =>
      i === 5 ? { ...p, equity: centavos(-1_00) } : p,
    );
    const rf = equityCurve.map(() => decimalString("0"));
    const { metrics, notes } = computeBacktestMetrics({
      equityCurve: dippedEquityCurve,
      initialCapital: centavos(100_000_00),
      rfPerSession: rf,
      held: equityCurve.map(() => true),
      settledOperationPnls: [],
      operationsCount: 0,
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    });
    expect(metrics.sharpe).toBeNull();
    expect(metrics.cagr).not.toBeNull();
    expect(notes).toEqual([
      {
        code: "non_positive_equity",
        message: "an equity point inside the window is non-positive; sharpe is undefined",
      },
    ]);
  });

  it("nulls cagr and sharpe (a walk-forward window's own non-positive baseline, not just its final equity)", () => {
    const equityCurve: EquityPoint[] = [];
    for (let i = 0; i < MIN_ANNUALIZED_SESSIONS; i += 1) {
      equityCurve.push(point(`s${String(i)}`, 10_000_00 + i * 100, "0"));
    }
    const rf = equityCurve.map(() => decimalString("0"));
    const { metrics, notes } = computeBacktestMetrics({
      equityCurve,
      initialCapital: centavos(-1_00),
      rfPerSession: rf,
      held: equityCurve.map(() => true),
      settledOperationPnls: [],
      operationsCount: 0,
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    });
    expect(metrics.cagr).toBeNull();
    expect(metrics.sharpe).toBeNull();
    expect(metrics.totalReturn).toBe(decimalString("0.000000"));
    expect(notes).toEqual([
      {
        code: "non_positive_equity",
        message:
          "the window's own starting equity is non-positive; every return in it is undefined",
      },
    ]);
  });

  it("computes sharpe and cagr against hand-computed decimal values over 126 alternating-return sessions", () => {
    const equityCents = [
      10200000, 10098000, 10299960, 10196960, 10400899, 10296890, 10502828, 10397800, 10605756,
      10499698, 10709692, 10602595, 10814647, 10706501, 10920631, 10811425, 11027654, 10917377,
      11135725, 11024368, 11244855, 11132406, 11355054, 11241503, 11466333, 11351670, 11578703,
      11462916, 11692174, 11575252, 11806757, 11688689, 11922463, 11803238, 12039303, 11918910,
      12157288, 12035715, 12276429, 12153665, 12396738, 12272771, 12518226, 12393044, 12640905,
      12514496, 12764786, 12637138, 12889881, 12760982, 13016202, 12886040, 13143761, 13012323,
      13272569, 13139843, 13402640, 13268614, 13533986, 13398646, 13666619, 13529953, 13800552,
      13662546, 13935797, 13796439, 14072368, 13931644, 14210277, 14068174, 14349537, 14206042,
      14490163, 14345261, 14632166, 14485844, 14775561, 14627805, 14920361, 14771157, 15066580,
      14915914, 15214232, 15062090, 15363332, 15209699, 15513893, 15358754, 15665929, 15509270,
      15819455, 15661260, 15974485, 15814740, 16131035, 15969725, 16289120, 16126229, 16448754,
      16284266, 16609951, 16443851, 16772728, 16605001, 16937101, 16767730, 17103085, 16932054,
      17270695, 17097988, 17439948, 17265549, 17610860, 17434751, 17783446, 17605612, 17957724,
      17778147, 18133710, 17952373, 18311420, 18128306, 18490872, 18305963, 18672082, 18485361,
    ];
    // Independently reproduced from the ADR-0013 formulas (mean(r - rf) / stdev(r - rf) *
    // sqrt(252) for sharpe; (equityLast / initialCapital)^(252 / sessions) - 1 for cagr) with a
    // fresh decimal.js script, not by exercising computeBacktestMetrics itself, over an equity
    // curve alternating +2% / -1% daily returns against a constant 0.01% per-session risk-free
    // rate, at MIN_ANNUALIZED_SESSIONS (126) sessions exactly.
    const equityCurve = equityCents.map((cents, i) => point(`s${String(i)}`, cents, "0"));
    const { metrics } = computeBacktestMetrics({
      equityCurve,
      initialCapital: centavos(100_000_00),
      rfPerSession: equityCents.map(() => decimalString("0.0001")),
      held: equityCents.map(() => true),
      settledOperationPnls: [],
      operationsCount: 0,
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    });
    expect(metrics.totalReturn).toBe(decimalString("0.848536"));
    expect(metrics.sharpe).toBe(decimalString("5.165050"));
    expect(metrics.cagr).toBe(decimalString("2.417086"));
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
