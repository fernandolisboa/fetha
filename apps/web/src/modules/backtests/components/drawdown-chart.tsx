"use client";

import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AreaClosed } from "@visx/shape";
import { Decimal } from "decimal.js";
import type { EquityPoint } from "@fetha/engine";

const MARGIN = { top: 8, right: 16, bottom: 28, left: 64 };
const HEIGHT = 120;

function Chart({ width, points }: { width: number; points: EquityPoint[] }) {
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const xScale = scalePoint<string>({
    domain: points.map((point) => point.session),
    range: [0, innerWidth],
  });
  const drawdowns = points.map((point) => new Decimal(point.drawdown).toNumber());
  const yScale = scaleLinear<number>({
    domain: [Math.min(...drawdowns, 0), 0],
    range: [innerHeight, 0],
    nice: true,
  });

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
          tickFormat={(value) => `${(Number(value) * 100).toFixed(0)}%`}
          numTicks={3}
        />
        <AxisBottom
          top={innerHeight}
          scale={xScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickLabelProps={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          numTicks={Math.min(6, points.length)}
        />
      </Group>
    </svg>
  );
}

export function DrawdownChart({ points }: { points: EquityPoint[] }) {
  if (points.length === 0) {
    return null;
  }
  return <ParentSize>{({ width }) => <Chart width={width} points={points} />}</ParentSize>;
}
