"use client";

import { useState, type MouseEvent } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleUtc } from "@visx/scale";
import { Line, LinePath } from "@visx/shape";
import type { DecimalString } from "@fetha/contracts";

import { formatDate } from "@/lib/format/date-time";
import { formatPercent } from "@/lib/format/percent";

import { fitLabel, spreadLabels, type CumulativeReturnPoint } from "../comparison";

export type ComparisonSeries = {
  id: string;
  label: string;
  color: string;
  points: CumulativeReturnPoint[];
};

const MARGIN = { top: 12, bottom: 28, left: 56 };
const HEIGHT = 280;
const LABEL_FONT_SIZE = 11;
// IBM Plex Mono advances 0.6em per glyph.
const LABEL_CHAR_WIDTH = LABEL_FONT_SIZE * 0.6;
const LABEL_GAP = 6;
const LABEL_LINE = 13;

function toDate(session: string): Date {
  return new Date(`${session}T12:00:00Z`);
}

function percent(value: number): string {
  return formatPercent(value.toFixed(6) as DecimalString);
}

function valueAt(points: CumulativeReturnPoint[], session: string): number | null {
  let found: number | null = null;
  for (const point of points) {
    if (point.session > session) break;
    found = point.value;
  }
  return found;
}

function Chart({ width, series }: { width: number; series: ComparisonSeries[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const longest = Math.max(...series.map((s) => s.label.length));
  const labelChars = Math.min(longest, Math.floor((width * 0.3) / LABEL_CHAR_WIDTH));
  const marginRight = Math.ceil(labelChars * LABEL_CHAR_WIDTH) + LABEL_GAP * 2;
  const innerWidth = Math.max(0, width - MARGIN.left - marginRight);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const sessions = [...new Set(series.flatMap((s) => s.points.map((p) => p.session)))].sort();
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  const first = sessions[0] ?? "";
  const last = sessions.at(-1) ?? first;

  const xScale = scaleUtc<number>({
    domain: [toDate(first), toDate(last)],
    range: [0, innerWidth],
  });
  const yScale = scaleLinear<number>({
    domain: [Math.min(...values, 0), Math.max(...values, 0)],
    range: [innerHeight, 0],
    nice: true,
  });

  function onMove(event: MouseEvent<SVGRectElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    const target = xScale.invert(event.clientX - bounds.left).getTime();
    let nearest = first;
    for (const session of sessions) {
      if (
        Math.abs(toDate(session).getTime() - target) < Math.abs(toDate(nearest).getTime() - target)
      ) {
        nearest = session;
      }
    }
    setHovered(nearest);
  }

  const hoveredX = hovered ? xScale(toDate(hovered)) : null;
  const labelYs = spreadLabels(
    series.map((s) => yScale(s.points.at(-1)?.value ?? 0)),
    LABEL_LINE,
    innerHeight,
  );

  return (
    <div className="relative">
      <svg width={width} height={HEIGHT} role="img" aria-label="Retorno acumulado por simulação">
        <Group left={MARGIN.left} top={MARGIN.top}>
          <Line
            from={{ x: 0, y: yScale(0) }}
            to={{ x: innerWidth, y: yScale(0) }}
            stroke="var(--muted)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          {series.map((s) => (
            <LinePath
              key={s.id}
              data={s.points}
              x={(point) => xScale(toDate(point.session))}
              y={(point) => yScale(point.value)}
              stroke={s.color}
              strokeWidth={2}
            />
          ))}
          {series.map((s, index) => {
            const end = s.points.at(-1);
            if (!end) return null;
            return (
              <text
                key={`${s.id}-label`}
                x={xScale(toDate(end.session)) + LABEL_GAP}
                y={labelYs[index]}
                dy="0.32em"
                fill="var(--ink)"
                fontSize={LABEL_FONT_SIZE}
                fontFamily="var(--font-mono)"
              >
                <title>{s.label}</title>
                {fitLabel(s.label, labelChars)}
              </text>
            );
          })}
          {hoveredX !== null ? (
            <Line
              from={{ x: hoveredX, y: 0 }}
              to={{ x: hoveredX, y: innerHeight }}
              stroke="var(--line)"
              strokeWidth={1}
            />
          ) : null}
          <AxisLeft
            scale={yScale}
            stroke="var(--line-soft)"
            tickStroke="var(--line-soft)"
            tickLabelProps={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
            tickFormat={(value) => percent(Number(value))}
            numTicks={5}
          />
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            stroke="var(--line-soft)"
            tickStroke="var(--line-soft)"
            tickLabelProps={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
            tickFormat={(value) =>
              formatDate(value instanceof Date ? value : new Date(Number(value)))
            }
            numTicks={Math.min(5, sessions.length)}
          />
          <rect
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => {
              setHovered(null);
            }}
          />
        </Group>
      </svg>
      {hovered && hoveredX !== null ? (
        <div
          className="border-border bg-card pointer-events-none absolute top-2 rounded-[var(--radius)] border px-2 py-1 text-xs"
          style={
            hoveredX + MARGIN.left > width / 2
              ? { right: width - (hoveredX + MARGIN.left) + 8 }
              : { left: hoveredX + MARGIN.left + 8 }
          }
        >
          <p className="text-muted-foreground font-mono tabular-nums">
            {formatDate(toDate(hovered))}
          </p>
          {series.map((s) => {
            const value = valueAt(s.points, hovered);
            return (
              <p key={s.id} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-3"
                  style={{ backgroundColor: s.color }}
                />
                <span>{s.label}</span>
                <span className="ml-auto font-mono tabular-nums">
                  {value === null ? "—" : percent(value)}
                </span>
              </p>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ComparisonChart({ series }: { series: ComparisonSeries[] }) {
  const plotted = series.filter((s) => s.points.length > 0);
  if (plotted.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {plotted.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-0.5 w-4"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </li>
        ))}
      </ul>
      <ParentSize style={{ height: HEIGHT }}>
        {({ width }) => (width > 0 ? <Chart width={width} series={plotted} /> : null)}
      </ParentSize>
    </div>
  );
}
