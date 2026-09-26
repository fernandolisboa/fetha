import Decimal from "decimal.js";
import type { Centavos, DecimalString, SessionDate } from "@fetha/contracts";
import type {
  EquityPoint,
  MonthlyTax,
  SimulatedFill,
  SimulatedOperation,
  WalkForwardWindow,
} from "../api";
import { computeBacktestMetrics, isSettledOperation, sumCentavos } from "./backtest-metrics";
import { RATIO_SCALE, toDecimalString } from "./decimal";
import { assertDefined } from "./invariant";

export type WalkForwardInput = {
  windowSessions: number;
  periodSessions: readonly SessionDate[];
  initialCapital: Centavos;
  equityCurve: readonly EquityPoint[];
  rfPerSession: readonly DecimalString[];
  held: readonly boolean[];
  operations: readonly SimulatedOperation[];
  fills: readonly SimulatedFill[];
  taxes: readonly MonthlyTax[];
  slippageEntries: readonly { session: SessionDate; amount: Centavos }[];
};

// Drawdown is re-measured inside the window from the window's own starting equity (ADR-0023): the
// run's EquityPoint.drawdown is measured from the run's running peak, which would carry an earlier
// window's loss into every later window that never fell on its own.
function rebaseDrawdown(points: readonly EquityPoint[], baseline: Centavos): EquityPoint[] {
  let peak: number = baseline;
  return points.map((point) => {
    peak = Math.max(peak, point.equity);
    const drawdown =
      peak <= 0 ? new Decimal(0) : new Decimal(1).sub(new Decimal(point.equity).div(peak));
    return { ...point, drawdown: toDecimalString(drawdown, RATIO_SCALE) };
  });
}

// A month's tax belongs to the window holding that month's last period session, where the month's
// gains are complete (ADR-0023), so a month cut by a window boundary is counted once.
function taxesByWindow(input: WalkForwardInput): Map<number, Centavos[]> {
  const byWindow = new Map<number, Centavos[]>();
  for (const monthly of input.taxes) {
    let lastIndex = 0;
    input.periodSessions.forEach((session, i) => {
      if (session.slice(0, 7) <= monthly.month) lastIndex = i;
    });
    const index = Math.floor(lastIndex / input.windowSessions);
    byWindow.set(index, [...(byWindow.get(index) ?? []), monthly.tax]);
  }
  return byWindow;
}

export function computeWalkForward(input: WalkForwardInput): WalkForwardWindow[] {
  const { windowSessions, periodSessions } = input;
  const taxes = taxesByWindow(input);
  const windows: WalkForwardWindow[] = [];
  for (let start = 0; start < periodSessions.length; start += windowSessions) {
    const end = Math.min(periodSessions.length, start + windowSessions);
    const index = windows.length;
    const from = assertDefined(periodSessions[start], "walk-forward: non-empty window");
    const to = assertDefined(periodSessions[end - 1], "walk-forward: non-empty window");
    const baseline =
      start === 0
        ? input.initialCapital
        : assertDefined(
            input.equityCurve[start - 1],
            "walk-forward: a completed run has one equity point per period session",
          ).equity;
    const inWindow = (session: SessionDate): boolean => session >= from && session <= to;
    const opsInWindow = input.operations.filter((op) => inWindow(op.openedAt));
    const { metrics } = computeBacktestMetrics({
      equityCurve: rebaseDrawdown(input.equityCurve.slice(start, end), baseline),
      initialCapital: baseline,
      rfPerSession: input.rfPerSession.slice(start, end),
      held: input.held.slice(start, end),
      settledOperationPnls: opsInWindow.filter(isSettledOperation).map((op) => op.pnl),
      operationsCount: opsInWindow.length,
      fees: sumCentavos(input.fills.filter((f) => inWindow(f.session)).map((f) => f.costs)),
      taxes: sumCentavos(taxes.get(index) ?? []),
      slippage: sumCentavos(
        input.slippageEntries.filter((s) => inWindow(s.session)).map((s) => s.amount),
      ),
    });
    windows.push({ from, to, metrics });
  }
  return windows;
}
