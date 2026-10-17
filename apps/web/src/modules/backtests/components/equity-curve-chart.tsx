"use client";

import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import type { Centavos } from "@fetha/contracts";
import type { EquityPoint } from "@fetha/engine";

import { DATE_TICK_SPACING, evenlySpaced, ticksThatFit } from "@/lib/chart-ticks";
import { formatBRL } from "@/lib/format/brl";
import { formatSessionDate } from "@/lib/format/date-time";

function tickLabel(value: number): string {
  return formatBRL(value as Centavos);
}

// The right margin holds half a dd/mm/yyyy tick label, centered on the last session.
const MARGIN = { top: 12, right: 40, bottom: 28 };
const HEIGHT = 200;
const Y_TICKS = 4;
// Every theme's mono font advances 0.6em (6.6px at 11px); 7px leaves room for renderers that draw it
// wider, as the CI runner's headless Chromium does. The left margin fits the widest y tick label.
const TICK_CHAR_WIDTH = 7;
const TICK_GAP = 12;

function Chart({ width, points }: { width: number; points: EquityPoint[] }) {
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const equityValues = points.map((point) => point.equity);
  const yScale = scaleLinear<number>({
    domain: [Math.min(...equityValues, 0), Math.max(...equityValues, 0)],
    range: [innerHeight, 0],
    nice: true,
  });
  const left =
    Math.ceil(
      Math.max(...yScale.ticks(Y_TICKS).map((tick) => tickLabel(tick).length)) * TICK_CHAR_WIDTH,
    ) + TICK_GAP;
  const innerWidth = Math.max(0, width - left - MARGIN.right);
  const xScale = scalePoint<string>({
    domain: points.map((point) => point.session),
    range: [0, innerWidth],
  });

  return (
    <svg width={width} height={HEIGHT} role="img" aria-label="Curva de patrimônio">
      <Group left={left} top={MARGIN.top}>
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
