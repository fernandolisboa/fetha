import { scaleLinear } from "@visx/scale";
import type { DecimalString } from "@fetha/contracts";

import { formatPriceBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";

import { isMarketIndex } from "../market-index";

export interface PlotPoint {
  session: string;
  value: number | null;
}

// Every theme's mono font advances 0.6em (6.6px at 11px); 7px leaves room for renderers that draw
// it wider, as the CI runner's headless Chromium does.
const TICK_CHAR_WIDTH = 7;
const TICK_GAP = 12;
const PADDING = 0.08;

const Y_TICKS = 4;

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
// with a margin instead of anchoring at 0, yet never below it: none of these can be negative. A
// flat series gets a band so it still draws a line mid-panel.
export function yDomain(values: readonly number[]): [number, number] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) {
    const band = Math.abs(low) * 0.05 || 1;
    return [Math.max(0, low - band), high + band];
  }
  const margin = (high - low) * PADDING;
  return [Math.max(0, low - margin), high + margin];
}

export interface YAxis {
  domain: [number, number];
  ticks: number[];
}

function onGrid(value: number, step: number, round: (value: number) => number): number {
  return Number((round(value / step) * step).toFixed(10));
}

// `minStep` is the smallest change the tick format can print (a centavo, a hundredth of a
// percentage point): a finer step would print two ticks with the same label.
export function yAxis(values: readonly number[], minStep: number): YAxis {
  const scale = scaleLinear<number>({ domain: yDomain(values), nice: true });
  const [low = 0, high = 0] = scale.domain();
  const ticks = scale.ticks(Y_TICKS);
  const [first, second] = ticks;
  if (first === undefined || second === undefined || second - first >= minStep) {
    return { domain: [low, high], ticks };
  }
  const floor = onGrid(low, minStep, Math.floor);
  const steps = Math.round((onGrid(high, minStep, Math.ceil) - floor) / minStep);
  const gridTicks = Array.from({ length: steps + 1 }, (_, index) =>
    onGrid(floor + index * minStep, minStep, Math.round),
  );
  return { domain: [floor, gridTicks.at(-1) ?? floor], ticks: gridTicks };
}

export function axisLeftMargin(labels: readonly string[]): number {
  const widest = Math.max(0, ...labels.map((label) => label.length));
  return Math.ceil(widest * TICK_CHAR_WIDTH) + TICK_GAP;
}

export const PRICE_TICK_STEP = 0.01;
export const VOLATILITY_TICK_STEP = 0.0001;

function toDecimal(value: number): DecimalString {
  return value.toFixed(6) as DecimalString;
}

export function formatPriceTick(value: number): string {
  return formatPriceBRL(toDecimal(value));
}

export function formatIndexTick(value: number): string {
  return formatDecimal(toDecimal(value));
}

export function formatVolatilityTick(value: number): string {
  return formatPercent(toDecimal(value));
}

// An index underlying (IBOV, ADR-0062) is quoted in points, never in reais.
export function underlyingTickFormat(underlying: string): (value: number) => string {
  return isMarketIndex(underlying) ? formatIndexTick : formatPriceTick;
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
