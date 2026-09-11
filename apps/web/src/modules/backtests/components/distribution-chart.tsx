"use client";

import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";

import { t } from "../strings";

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
// distinct labels regardless of how narrow the spread is (round 2 item 14),
// down to a bin width of 0.0001 percentage points: below that the 4-decimal
// cap (chosen so the axis never grows wider than "−0,0001%") reopens the
// same duplicate-label case this function exists to close, for a spread a
// real backtest's per-session returns cannot produce (round 3 item 12).
function decimalsForBinWidth(widthPercent: number): number {
  if (!Number.isFinite(widthPercent) || widthPercent <= 0) return 1;
  if (widthPercent >= 1) return 1;
  const magnitude = Math.floor(Math.log10(widthPercent));
  return Math.min(4, Math.max(1, 1 - magnitude));
}

// True minus and pt-BR's comma decimal separator (DESIGN.md "Formatting
// (pt-BR)"), not the hyphen-minus and dot `Number.prototype.toFixed`
// produces, to match formatBRL/formatPercent and the rest of the report
// (round 3 item 12).
// A value that rounds to zero at the chosen precision never carries the
// minus sign: DESIGN.md never shows a signed zero, and a bin whose true
// value is a small negative number straddling zero is exactly the case
// that produced one before precision scaled with bin width.
function percentLabel(value: number, decimals: number): string {
  const rounded = Number(Math.abs(value).toFixed(decimals));
  const isZero = rounded === 0;
  const formatted = rounded.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${!isZero && value < 0 ? "−" : ""}${formatted}%`;
}

export function buildBins(returns: number[]): Bin[] {
  if (returns.length === 0) {
    return [];
  }
  const min = Math.min(...returns, 0);
  const max = Math.max(...returns, 0);
  const span = max - min;
  // A flat equity curve (a strategy that never fires) makes every return,
  // and so both widened bounds, exactly 0: a genuinely zero span, not one
  // too small to bin. The old `|| 1` fallback treated it as the latter and
  // fabricated a 0%-100% axis no data in the run supports (round 4 item 6);
  // the caller renders this state explicitly instead of a chart.
  if (span === 0) {
    return [];
  }
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
  // A flat equity curve renders no bins (buildBins, above): an explicit
  // message, not a silently empty chart or a fabricated axis (round 4
  // item 6).
  if (buildBins(returns).length === 0) {
    return <p className="text-muted-foreground text-sm">{t.report.distributionFlat}</p>;
  }
  return <ParentSize>{({ width }) => <Chart width={width} returns={returns} />}</ParentSize>;
}
