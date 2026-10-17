"use client";

import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AreaClosed } from "@visx/shape";
import { Decimal } from "decimal.js";
import type { EquityPoint } from "@fetha/engine";

import { DATE_TICK_SPACING, evenlySpaced, ticksThatFit } from "@/lib/chart-ticks";
import { formatSessionDate } from "@/lib/format/date-time";

// The right margin holds half a dd/mm/yyyy tick label, centered on the last session.
const MARGIN = { top: 8, right: 40, bottom: 28, left: 64 };
const HEIGHT = 120;

const Y_TICKS = 3;

// True minus and decimal comma (DESIGN.md "Formatting (pt-BR)"), not the hyphen-minus and point
// `Number.prototype.toFixed` produces, to match formatBRL/formatPercent. A value that rounds to
// zero never carries the sign: DESIGN.md never shows a signed zero.
export function percentTick(value: number, decimals: number): string {
  const magnitude = Math.abs(value).toFixed(decimals);
  const sign = value < 0 && Number(magnitude) !== 0 ? "−" : "";
  return `${sign}${magnitude.replace(".", ",")}%`;
}

// A run whose deepest drawdown is a couple of percent gets ticks half a point apart: whole
// percents would print the same label twice.
export function percentTickDecimals(ticks: number[]): number {
  const [first, second] = ticks;
  if (first === undefined || second === undefined) return 0;
  const stepPercent = Math.abs(second - first) * 100;
  if (stepPercent >= 1) return 0;
  return Math.min(4, Math.ceil(-Math.log10(stepPercent)));
}

// EquityPoint.drawdown is a non-negative fraction (magnitude of the drop
// from the running peak), so the domain's upper bound is the run's own
// deepest drawdown, not 0: `[min(drawdowns, 0), 0]` collapses to `[0, 0]`
// for every real run and renders an empty panel.
export function drawdownDomain(points: EquityPoint[]): [number, number] {
  const drawdowns = points.map((point) => new Decimal(point.drawdown).toNumber());
  return [0, Math.max(...drawdowns, 0)];
}

function Chart({ width, points }: { width: number; points: EquityPoint[] }) {
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const xScale = scalePoint<string>({
    domain: points.map((point) => point.session),
    range: [0, innerWidth],
  });
  const yScale = scaleLinear<number>({
    domain: drawdownDomain(points),
    range: [0, innerHeight],
    nice: true,
  });

  const decimals = percentTickDecimals(yScale.ticks(Y_TICKS));

  return (
    <svg width={width} height={HEIGHT} role="img" aria-label="Drawdown">
      <Group left={MARGIN.left} top={MARGIN.top}>
        <AreaClosed
          data={points}
          x={(point) => xScale(point.session) ?? 0}
          y={(point) => yScale(new Decimal(point.drawdown).toNumber())}
          yScale={yScale}
          fill="var(--down)"
          fillOpacity={0.35}
        />
        <AxisLeft
          scale={yScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickLabelProps={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          tickFormat={(value) => percentTick(-Number(value) * 100, decimals)}
          numTicks={Y_TICKS}
        />
        <AxisBottom
          top={innerHeight}
          scale={xScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickLabelProps={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          tickValues={evenlySpaced(
            points.map((point) => point.session),
            ticksThatFit(innerWidth, DATE_TICK_SPACING, 6),
          )}
          tickFormat={formatSessionDate}
        />
      </Group>
    </svg>
  );
}

export function DrawdownChart({ points }: { points: EquityPoint[] }) {
  if (points.length === 0) {
    return null;
  }
  return (
    <ParentSize style={{ height: HEIGHT }}>
      {({ width }) => <Chart width={width} points={points} />}
    </ParentSize>
  );
}
