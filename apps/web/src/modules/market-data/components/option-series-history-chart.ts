import { scaleLinear } from "@visx/scale";
import type { DecimalString } from "@fetha/contracts";

import { formatPriceBRL } from "@/lib/format/brl";
import { formatPercent } from "@/lib/format/percent";

export interface PlotPoint {
  session: string;
  value: number | null;
}

// Every theme's mono font advances 0.6em (6.6px at 11px); 7px leaves room for renderers that draw
// it wider, as the CI runner's headless Chromium does.
const TICK_CHAR_WIDTH = 7;
const TICK_GAP = 12;
const PADDING = 0.08;

export const Y_TICKS = 4;

export function toPlotPoints<T extends { session: string }>(
  points: readonly T[],
  pick: (point: T) => DecimalString | null,
): PlotPoint[] {
  return points.map((point) => {
    const picked = pick(point);
    return { session: point.session, value: picked === null ? null : Number(picked) };
  });
}

export function definedValues(points: readonly PlotPoint[]): number[] {
  return points.flatMap((point) => (point.value === null ? [] : [point.value]));
}

// A level series (a price, a volatility) has no meaningful zero, so the y axis frames the data
// with a margin instead of anchoring at 0; a flat series gets a symmetric band so it still
// draws a line mid-panel.
export function yDomain(values: readonly number[]): [number, number] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) {
    const band = Math.abs(low) * 0.05 || 1;
    return [low - band, high + band];
  }
  const margin = (high - low) * PADDING;
  return [low - margin, high + margin];
}

export function yTicks(domain: readonly [number, number], height: number): number[] {
  return scaleLinear<number>({ domain: [...domain], range: [height, 0], nice: true }).ticks(
    Y_TICKS,
  );
}

export function axisLeftMargin(labels: readonly string[]): number {
  const widest = Math.max(0, ...labels.map((label) => label.length));
  return Math.ceil(widest * TICK_CHAR_WIDTH) + TICK_GAP;
}

function toDecimal(value: number): DecimalString {
  return value.toFixed(6) as DecimalString;
}

export function formatPriceTick(value: number): string {
  return formatPriceBRL(toDecimal(value));
}

export function formatVolatilityTick(value: number): string {
  return formatPercent(toDecimal(value));
}

// The index of the session nearest to `x` on an evenly spaced point scale of `count` sessions
// laid over `width` pixels.
export function nearestIndex(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, x / width));
  return Math.round(ratio * (count - 1));
}

// A defined point with no defined neighbour draws no line segment, so it needs its own dot.
export function isolatedIndexes(points: readonly PlotPoint[]): number[] {
  const indexes: number[] = [];
  points.forEach((point, index) => {
    if (point.value === null) return;
    const before = points[index - 1]?.value ?? null;
    const after = points[index + 1]?.value ?? null;
    if (before === null && after === null) indexes.push(index);
  });
  return indexes;
}
