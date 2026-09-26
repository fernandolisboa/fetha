import { Decimal } from "decimal.js";
import type { Centavos, DecimalString, SessionDate } from "@fetha/contracts";
import type { BacktestRun, EquityPoint, WalkForwardWindow } from "@fetha/engine";

// ADR-0023: three is where the comparison series palette still separates every pair of lines,
// including under colour-vision deficiency; a fourth run is a second comparison.
export const MAX_COMPARED_RUNS = 3;

export type ComparedRun = {
  id: string;
  href: string;
  label: string;
  result: BacktestRun;
};

export type PickerRun = { id: string; label: string; period: string };
export type PickerGroup = { strategyId: string; strategyName: string; runs: PickerRun[] };

export function requestedRunIds(param: string | string[] | undefined): string[] {
  const values = param === undefined ? [] : Array.isArray(param) ? param : [param];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function comparedRunIds(param: string | string[] | undefined): string[] {
  return requestedRunIds(param).slice(0, MAX_COMPARED_RUNS);
}

export function compareHref(ids: readonly string[]): string {
  const query = new URLSearchParams(ids.map((id) => ["run", id]));
  return `/estrategias/comparar?${query.toString()}`;
}

export type ReturnTone = "up" | "down" | "flat";

export function returnTone(value: DecimalString): ReturnTone {
  const decimal = new Decimal(value);
  if (decimal.isZero()) return "flat";
  return decimal.isNegative() ? "down" : "up";
}

export type CumulativeReturnPoint = { session: SessionDate; value: number };

// The comparison's equity curve (ADR-0023): each run's equity as a return on its own initial
// capital, so runs started with different capital share one percentage axis.
export function cumulativeReturns(
  initialCapital: Centavos,
  equityCurve: readonly EquityPoint[],
): CumulativeReturnPoint[] {
  if (initialCapital <= 0) return [];
  return equityCurve.map((point) => ({
    session: point.session,
    value: new Decimal(point.equity).div(initialCapital).minus(1).toNumber(),
  }));
}

export type AlignedWindowRow = {
  from: SessionDate;
  to: SessionDate;
  cells: (WalkForwardWindow | null)[];
};

// One row per distinct window across the compared runs, in date order. Runs over the same period
// with the same window length line up row for row; any other run leaves a gap where it has no
// window with those exact bounds.
export function alignWindows(
  runs: readonly { walkForward: WalkForwardWindow[] | null }[],
): AlignedWindowRow[] {
  const rows = new Map<string, AlignedWindowRow>();
  runs.forEach((run, index) => {
    for (const window of run.walkForward ?? []) {
      const key = `${window.from}|${window.to}`;
      const row = rows.get(key) ?? {
        from: window.from,
        to: window.to,
        cells: runs.map(() => null),
      };
      row.cells[index] = window;
      rows.set(key, row);
    }
  });
  return [...rows.values()].sort((a, b) =>
    a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from),
  );
}

export type LabelInput = {
  id: string;
  strategyId: string;
  strategyName: string;
  versionNumber: number;
  createdAt: string;
};

// A run is named by its version when every compared run belongs to one strategy, and by strategy
// and version otherwise; two runs of the same version are told apart by their creation date and time.
export function runLabels(runs: readonly LabelInput[]): Map<string, string> {
  const oneStrategy = new Set(runs.map((run) => run.strategyId)).size <= 1;
  const base = runs.map((run) =>
    oneStrategy
      ? `v${String(run.versionNumber)}`
      : `${run.strategyName} v${String(run.versionNumber)}`,
  );
  return new Map(
    runs.map((run, index) => {
      const label = base[index] ?? "";
      const duplicated = base.filter((candidate) => candidate === label).length > 1;
      return [run.id, duplicated ? `${label} · ${run.createdAt}` : label];
    }),
  );
}

export function spreadLabels(ys: readonly number[], minGap: number, height: number): number[] {
  const order = ys.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  const placed = order.map(({ y }) => y);
  for (let i = 1; i < placed.length; i += 1) {
    placed[i] = Math.max(placed[i] ?? 0, (placed[i - 1] ?? 0) + minGap);
  }
  const overflow = Math.max(0, (placed.at(-1) ?? 0) - height);
  const result = new Array<number>(ys.length);
  order.forEach(({ index }, i) => {
    result[index] = (placed[i] ?? 0) - overflow;
  });
  return result;
}

export function fitLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(0, maxChars - 1))}…`;
}
