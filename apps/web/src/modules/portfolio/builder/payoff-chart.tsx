"use client";

import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, Line, LinePath } from "@visx/shape";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { centavosSchema, type DecimalString } from "@fetha/contracts";
import type { PayoffPoint } from "@fetha/engine";

import { formatBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";

import { t } from "../strings";

const MARGIN = { top: 12, right: 56, bottom: 28, left: 56 };

type PlotPoint = { underlying: number; pnl: number };

// The engine only emits three points (0.8/1/1.2 of spot) plus the
// break-evens it solved for exactly (pnl = 0); a smooth curve fitted
// through the three alone fabricates values between the real kinks at
// each leg's strike (round 1 item 5, reproduced: a drawn zero-crossing off
// the displayed break-even). Merging the break-evens in as true zero
// points and connecting only known values keeps the line honest.
function plotPoints(points: PayoffPoint[], breakEvens: DecimalString[]): PlotPoint[] {
  const merged = new Map<number, number>();
  for (const point of points) {
    merged.set(Number(point.underlying), point.pnl);
  }
  for (const breakEven of breakEvens) {
    const underlying = Number(breakEven);
    if (!merged.has(underlying)) {
      merged.set(underlying, 0);
    }
  }
  return [...merged.entries()]
    .map(([underlying, pnl]) => ({ underlying, pnl }))
    .sort((a, b) => a.underlying - b.underlying);
}

function formatAxisBRL(value: number): string {
  return formatBRL(centavosSchema.parse(Math.round(value)));
}

function Chart({
  width,
  points,
  spot,
  breakEvens,
}: {
  width: number;
  points: PayoffPoint[];
  spot: number;
  breakEvens: DecimalString[];
}) {
  const height = Math.round((width * 340) / 800);
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const plot = plotPoints(points, breakEvens);
  const underlyings = plot.map((point) => point.underlying);
  const pnls = plot.map((point) => point.pnl);

  const xScale = scaleLinear({
    domain: [Math.min(...underlyings), Math.max(...underlyings)],
    range: [0, innerWidth],
  });
  const maxAbsPnl = Math.max(1, ...pnls.map((pnl) => Math.abs(pnl)));
  const yScale = scaleLinear({
    domain: [-maxAbsPnl, maxAbsPnl],
    range: [innerHeight, 0],
  });

  return (
    <svg width={width} height={height} role="img" aria-label={t.builder.payoffChart.pnl}>
      <Group left={MARGIN.left} top={MARGIN.top}>
        <Line
          from={{ x: 0, y: yScale(0) }}
          to={{ x: innerWidth, y: yScale(0) }}
          stroke="var(--muted)"
          strokeDasharray="4,4"
        />
        <Line
          from={{ x: xScale(spot), y: 0 }}
          to={{ x: xScale(spot), y: innerHeight }}
          stroke="var(--ink)"
          strokeDasharray="2,2"
        />
        <AreaClosed
          data={plot}
          x={(point) => xScale(point.underlying)}
          y={(point) => (point.pnl >= 0 ? yScale(point.pnl) : yScale(0))}
          yScale={yScale}
          fill="var(--up)"
          opacity={0.12}
        />
        <AreaClosed
          data={plot}
          x={(point) => xScale(point.underlying)}
          y={(point) => (point.pnl < 0 ? yScale(point.pnl) : yScale(0))}
          yScale={yScale}
          fill="var(--down)"
          opacity={0.12}
        />
        <LinePath
          data={plot}
          x={(point) => xScale(point.underlying)}
          y={(point) => yScale(point.pnl)}
          stroke="var(--chart-stroke)"
          strokeWidth={1.5}
        />
        {breakEvens.map((breakEven) => {
          const x = xScale(Number(breakEven));
          const y = yScale(0);
          return (
            <Group key={breakEven}>
              <circle
                cx={x}
                cy={y}
                r={4}
                fill="var(--surface)"
                stroke="var(--ink)"
                strokeWidth={1.5}
              />
              <text
                x={x}
                y={y - 10}
                textAnchor="middle"
                fill="var(--ink)"
                fontSize={11}
                fontFamily="var(--font-mono)"
              >
                {formatDecimal(breakEven)}
              </text>
            </Group>
          );
        })}
        <AxisBottom
          top={innerHeight}
          scale={xScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickLabelProps={() => ({
            fill: "var(--muted)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
          })}
        />
        <AxisLeft
          scale={yScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickFormat={(value) => formatAxisBRL(Number(value))}
          tickLabelProps={() => ({
            fill: "var(--muted)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
          })}
        />
      </Group>
    </svg>
  );
}

export function PayoffChart({
  points,
  spot,
  breakEvens,
}: {
  points: PayoffPoint[];
  spot: string;
  breakEvens: DecimalString[];
}) {
  if (points.length === 0) {
    return null;
  }
  return (
    <ParentSize>
      {({ width }) =>
        width > 0 ? (
          <Chart width={width} points={points} spot={Number(spot)} breakEvens={breakEvens} />
        ) : null
      }
    </ParentSize>
  );
}
