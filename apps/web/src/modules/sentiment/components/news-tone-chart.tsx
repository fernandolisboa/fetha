"use client";

import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleUtc } from "@visx/scale";
import { Line, LinePath } from "@visx/shape";
import { Decimal } from "decimal.js";

export interface NewsToneChartPoint {
  day: string;
  tone: string;
  articles: number;
}

const MARGIN = { top: 8, right: 12, bottom: 24, left: 40 };
const HEIGHT = 120;

export function toneTick(value: number): string {
  const magnitude = Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return `${value < 0 ? "−" : ""}${magnitude}`;
}

function dayTick(date: Date): string {
  const day = date.toISOString();
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function dateOf(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

// Symmetric around zero so the zero line always shows and a mostly negative
// series is not drawn as if it were neutral.
export function toneDomain(points: readonly NewsToneChartPoint[]): [number, number] {
  const extent = Math.max(
    1,
    ...points
      .filter((point) => point.articles > 0)
      .map((point) => new Decimal(point.tone).abs().toNumber()),
  );
  return [-extent, extent];
}

function Chart({
  width,
  points,
  label,
}: {
  width: number;
  points: NewsToneChartPoint[];
  label: string;
}) {
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = scaleUtc<number>({
    domain: [dateOf(points[0]?.day ?? ""), dateOf(points.at(-1)?.day ?? "")],
    range: [0, innerWidth],
  });
  const yScale = scaleLinear<number>({
    domain: toneDomain(points),
    range: [innerHeight, 0],
    nice: true,
  });
  return (
    <svg width={width} height={HEIGHT} role="img" aria-label={label}>
      <Group left={MARGIN.left} top={MARGIN.top}>
        <Line
          from={{ x: 0, y: yScale(0) }}
          to={{ x: innerWidth, y: yScale(0) }}
          stroke="var(--line)"
          strokeWidth={1}
        />
        <LinePath
          data={points}
          // A day without articles has no tone: the line breaks there rather
          // than joining distant days as if coverage were continuous.
          defined={(point) => point.articles > 0}
          x={(point) => xScale(dateOf(point.day))}
          y={(point) => yScale(new Decimal(point.tone).toNumber())}
          stroke="var(--chart-stroke)"
          strokeWidth={1.5}
        />
        <AxisLeft
          scale={yScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickLabelProps={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          tickFormat={(value) => toneTick(Number(value))}
          numTicks={3}
        />
        <AxisBottom
          top={innerHeight}
          scale={xScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickLabelProps={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          tickFormat={(value) => dayTick(value instanceof Date ? value : new Date(value.valueOf()))}
          numTicks={5}
        />
      </Group>
    </svg>
  );
}

export function NewsToneChart({ points, label }: { points: NewsToneChartPoint[]; label: string }) {
  return (
    <ParentSize style={{ height: HEIGHT }}>
      {({ width }) => <Chart width={width} points={points} label={label} />}
    </ParentSize>
  );
}
