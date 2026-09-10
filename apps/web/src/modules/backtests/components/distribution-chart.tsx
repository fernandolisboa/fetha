"use client";

import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";

const MARGIN = { top: 8, right: 16, bottom: 28, left: 40 };
const HEIGHT = 180;
const BIN_COUNT = 10;

interface Bin {
  id: string;
  label: string;
  count: number;
  isZeroBin: boolean;
}

// One decimal is enough to tell consecutive bins apart when the spread is
// a few percent wide, but a sub-1% spread (common for per-session, not
// per-operation, returns — round 2 item 13) rounds every bin to the same
// "0.0%" at one decimal: duplicate axis labels, and a bin straddling zero
// rounds to a signed "−0.0%" that DESIGN.md forbids. Precision scales with
// the bin's own width in percentage points so neighbouring bins keep
// distinct labels regardless of how narrow the spread is (round 2 item 14).
function decimalsForBinWidth(widthPercent: number): number {
  if (!Number.isFinite(widthPercent) || widthPercent <= 0) return 1;
  if (widthPercent >= 1) return 1;
  const magnitude = Math.floor(Math.log10(widthPercent));
  return Math.min(4, Math.max(1, 1 - magnitude));
}

// True minus (DESIGN.md "Formatting (pt-BR)"), not the hyphen-minus
// `Number.prototype.toFixed` produces, to match formatBRL/formatPercent.
// A value that rounds to zero at the chosen precision never carries the
// minus sign: DESIGN.md never shows a signed zero, and a bin whose true
// value is a small negative number straddling zero is exactly the case
// that produced one before precision scaled with bin width.
function percentLabel(value: number, decimals: number): string {
  const rounded = Math.abs(value).toFixed(decimals);
  const isZero = Number(rounded) === 0;
  return `${!isZero && value < 0 ? "−" : ""}${rounded}%`;
}

export function buildBins(returns: number[]): Bin[] {
  if (returns.length === 0) {
    return [];
  }
  const min = Math.min(...returns, 0);
  const max = Math.max(...returns, 0);
  const span = max - min || 1;
  const width = span / BIN_COUNT;
  const decimals = decimalsForBinWidth(width * 100);

  const bins: Bin[] = Array.from({ length: BIN_COUNT }, (_, index) => {
    const lower = min + index * width;
    return {
      id: String(index),
      label: percentLabel(lower * 100, decimals),
      count: 0,
      isZeroBin: lower <= 0 && lower + width > 0,
    };
  });

  for (const value of returns) {
    const rawIndex = Math.floor((value - min) / width);
    const index = Math.min(BIN_COUNT - 1, Math.max(0, rawIndex));
    const bin = bins[index];
    if (bin) bin.count += 1;
  }
  return bins;
}

function Chart({ width, returns }: { width: number; returns: number[] }) {
  const bins = buildBins(returns);
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const xScale = scaleBand<string>({
    domain: bins.map((bin) => bin.id),
    range: [0, innerWidth],
    padding: 0.2,
  });
  const yScale = scaleLinear<number>({
    domain: [0, Math.max(1, ...bins.map((bin) => bin.count))],
    range: [innerHeight, 0],
    nice: true,
  });
  const labelById = new Map(bins.map((bin) => [bin.id, bin.label]));

  return (
    <svg width={width} height={HEIGHT} role="img" aria-label="Distribuição de retornos">
      <Group left={MARGIN.left} top={MARGIN.top}>
        {bins.map((bin) => (
          <Bar
            key={bin.id}
            x={xScale(bin.id) ?? 0}
            y={yScale(bin.count)}
            width={xScale.bandwidth()}
            height={innerHeight - yScale(bin.count)}
            fill={bin.isZeroBin ? "var(--accent-soft)" : "var(--surface-2)"}
            stroke={bin.isZeroBin ? "var(--accent)" : "var(--line-soft)"}
          />
        ))}
        <AxisLeft
          scale={yScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickLabelProps={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          numTicks={3}
        />
        <AxisBottom
          top={innerHeight}
          scale={xScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickFormat={(id) => labelById.get(id) ?? id}
          tickLabelProps={{ fill: "var(--muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        />
      </Group>
    </svg>
  );
}

export function DistributionChart({ returns }: { returns: number[] }) {
  if (returns.length === 0) {
    return null;
  }
  return <ParentSize>{({ width }) => <Chart width={width} returns={returns} />}</ParentSize>;
}
