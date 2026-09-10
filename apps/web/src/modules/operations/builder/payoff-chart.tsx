"use client";

import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, Line, LinePath } from "@visx/shape";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import type { PayoffPoint } from "@fetha/engine";

import { t } from "../strings";

const MARGIN = { top: 12, right: 16, bottom: 28, left: 56 };

function Chart({ width, points, spot }: { width: number; points: PayoffPoint[]; spot: number }) {
  const height = Math.round((width * 340) / 800);
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const underlyings = points.map((point) => Number(point.underlying));
  const pnls = points.map((point) => point.pnl);

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
          data={points}
          x={(point) => xScale(Number(point.underlying))}
          y={(point) => (point.pnl >= 0 ? yScale(point.pnl) : yScale(0))}
          yScale={yScale}
          fill="var(--up)"
          opacity={0.12}
        />
        <AreaClosed
          data={points}
          x={(point) => xScale(Number(point.underlying))}
          y={(point) => (point.pnl < 0 ? yScale(point.pnl) : yScale(0))}
          yScale={yScale}
          fill="var(--down)"
          opacity={0.12}
        />
        <LinePath
          data={points}
          x={(point) => xScale(Number(point.underlying))}
          y={(point) => yScale(point.pnl)}
          stroke="var(--chart-stroke)"
          strokeWidth={1.5}
        />
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

export function PayoffChart({ points, spot }: { points: PayoffPoint[]; spot: string }) {
  if (points.length === 0) {
    return null;
  }
  return (
    <ParentSize>
      {({ width }) =>
        width > 0 ? <Chart width={width} points={points} spot={Number(spot)} /> : null
      }
    </ParentSize>
  );
}
