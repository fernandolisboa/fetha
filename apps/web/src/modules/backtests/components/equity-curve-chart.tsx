"use client";

import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import type { Centavos } from "@fetha/contracts";
import type { EquityPoint } from "@fetha/engine";

import { formatBRL } from "@/lib/format/brl";

function tickLabel(value: number): string {
  return formatBRL(value as Centavos);
}

const MARGIN = { top: 12, right: 16, bottom: 28, left: 64 };
const HEIGHT = 200;

function Chart({ width, points }: { width: number; points: EquityPoint[] }) {
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const xScale = scalePoint<string>({
    domain: points.map((point) => point.session),
    range: [0, innerWidth],
  });
  const equityValues = points.map((point) => point.equity);
  const yScale = scaleLinear<number>({
    domain: [Math.min(...equityValues, 0), Math.max(...equityValues, 0)],
    range: [innerHeight, 0],
    nice: true,
  });

  return (
    <svg width={width} height={HEIGHT} role="img" aria-label="Curva de patrimônio">
      <Group left={MARGIN.left} top={MARGIN.top}>
        <AreaClosed
          data={points}
          x={(point) => xScale(point.session) ?? 0}
          y={(point) => yScale(point.equity)}
          yScale={yScale}
          fill="var(--up)"
          fillOpacity={0.12}
        />
        <LinePath
          data={points}
          x={(point) => xScale(point.session) ?? 0}
          y={(point) => yScale(point.equity)}
          stroke="var(--chart-stroke)"
          strokeWidth={1.5}
        />
        <AxisLeft
          scale={yScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickLabelProps={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          tickFormat={(value) => tickLabel(Number(value))}
          numTicks={4}
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

export function EquityCurveChart({ points }: { points: EquityPoint[] }) {
  if (points.length === 0) {
    return null;
  }
  return (
    <ParentSize style={{ height: HEIGHT }}>
      {({ width }) => <Chart width={width} points={points} />}
    </ParentSize>
  );
}
