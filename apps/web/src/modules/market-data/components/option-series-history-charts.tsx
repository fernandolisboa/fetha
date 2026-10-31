"use client";

import { useState, type PointerEvent } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scalePoint } from "@visx/scale";
import { Line, LinePath } from "@visx/shape";

import { DATE_TICK_SPACING, evenlySpaced, ticksThatFit } from "@/lib/chart-ticks";
import { formatSessionDate } from "@/lib/format/date-time";

import type { OptionSeriesHistoryPoint } from "../option-series-history";
import { t } from "../strings";
import {
  axisLeftMargin,
  definedValues,
  formatPriceTick,
  formatVolatilityTick,
  isolatedIndexes,
  nearestIndex,
  PRICE_TICK_STEP,
  toPlotPoints,
  underlyingTickFormat,
  VOLATILITY_TICK_STEP,
  yAxis,
  type PlotPoint,
  type YAxis,
} from "./option-series-history-chart";

const labels = t.optionSeries.history;

// The right margin holds half a dd/mm/yyyy tick label, centered on the last session.
const MARGIN = { top: 8, bottom: 6, right: 40 };
const AXIS_HEIGHT = 22;
const PLOT_HEIGHT = 104;
const DOT_RADIUS = 3;
const TICK_LABEL_PROPS = { fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-mono)" };

interface Row {
  id: string;
  label: string;
  stroke: string;
  points: PlotPoint[];
  format: (value: number) => string;
  tickStep: number;
  axis: YAxis;
}

function rowHeight(showAxis: boolean): number {
  return MARGIN.top + PLOT_HEIGHT + MARGIN.bottom + (showAxis ? AXIS_HEIGHT : 0);
}

function Chart({
  width,
  row,
  left,
  hovered,
  showAxis,
  onHover,
}: {
  width: number;
  row: Row;
  left: number;
  hovered: number | null;
  showAxis: boolean;
  onHover: (index: number | null) => void;
}) {
  const innerWidth = Math.max(0, width - left - MARGIN.right);
  const yScale = scaleLinear<number>({ domain: row.axis.domain, range: [PLOT_HEIGHT, 0] });
  const sessions = row.points.map((point) => point.session);
  const xScale = scalePoint<string>({ domain: sessions, range: [0, innerWidth] });
  const x = (session: string): number => xScale(session) ?? 0;
  const hoveredPoint = hovered === null ? null : (row.points[hovered] ?? null);

  function onMove(event: PointerEvent<SVGRectElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    onHover(nearestIndex(event.clientX - bounds.left, innerWidth, sessions.length));
  }

  return (
    <svg
      width={width}
      height={rowHeight(showAxis)}
      role="img"
      aria-label={row.label}
      data-testid={`option-series-history-${row.id}`}
    >
      <Group left={left} top={MARGIN.top}>
        {row.axis.ticks.map((tick) => (
          <Line
            key={tick}
            from={{ x: 0, y: yScale(tick) }}
            to={{ x: innerWidth, y: yScale(tick) }}
            stroke="var(--line-soft)"
            strokeWidth={1}
          />
        ))}
        <LinePath
          data={row.points}
          defined={(point) => point.value !== null}
          x={(point) => x(point.session)}
          y={(point) => yScale(point.value ?? 0)}
          stroke={row.stroke}
          strokeWidth={1.5}
        />
        {isolatedIndexes(row.points).map((index) => {
          const point = row.points[index];
          return point?.value == null ? null : (
            <circle
              key={point.session}
              cx={x(point.session)}
              cy={yScale(point.value)}
              r={DOT_RADIUS}
              fill={row.stroke}
            />
          );
        })}
        {hoveredPoint ? (
          <>
            <Line
              from={{ x: x(hoveredPoint.session), y: 0 }}
              to={{ x: x(hoveredPoint.session), y: PLOT_HEIGHT }}
              stroke="var(--line)"
              strokeWidth={1}
            />
            {hoveredPoint.value === null ? null : (
              <circle
                cx={x(hoveredPoint.session)}
                cy={yScale(hoveredPoint.value)}
                r={DOT_RADIUS}
                fill={row.stroke}
              />
            )}
          </>
        ) : null}
        <AxisLeft
          scale={yScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickLabelProps={TICK_LABEL_PROPS}
          tickFormat={(value) => row.format(Number(value))}
          tickValues={row.axis.ticks}
        />
        {showAxis ? (
          <AxisBottom
            top={PLOT_HEIGHT}
            scale={xScale}
            stroke="var(--line-soft)"
            tickStroke="var(--line-soft)"
            tickLabelProps={TICK_LABEL_PROPS}
            tickValues={evenlySpaced(sessions, ticksThatFit(innerWidth, DATE_TICK_SPACING, 6))}
            tickFormat={formatSessionDate}
          />
        ) : null}
        <rect
          width={innerWidth}
          height={PLOT_HEIGHT}
          fill="transparent"
          style={{ touchAction: "pan-y" }}
          onPointerMove={onMove}
          onPointerLeave={() => {
            onHover(null);
          }}
        />
      </Group>
    </svg>
  );
}

function shownIndex(points: readonly PlotPoint[], hovered: number | null): number {
  if (hovered !== null) return hovered;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index]?.value !== null) return index;
  }
  return points.length - 1;
}

export function OptionSeriesHistoryCharts({
  points,
  underlying,
}: {
  points: OptionSeriesHistoryPoint[];
  underlying: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const candidates: Omit<Row, "axis">[] = [
    {
      id: "close",
      label: labels.seriesClose,
      stroke: "var(--chart-stroke)",
      points: toPlotPoints(points, (point) => point.close),
      format: formatPriceTick,
      tickStep: PRICE_TICK_STEP,
    },
    {
      id: "underlying",
      label: labels.underlyingClose(underlying),
      stroke: "var(--series-2)",
      points: toPlotPoints(points, (point) => point.underlyingClose),
      format: underlyingTickFormat(underlying),
      tickStep: PRICE_TICK_STEP,
    },
    {
      id: "volatility",
      label: labels.impliedVolatility,
      stroke: "var(--series-3)",
      points: toPlotPoints(points, (point) => point.impliedVolatility),
      format: formatVolatilityTick,
      tickStep: VOLATILITY_TICK_STEP,
    },
  ];
  const rows: Row[] = candidates.flatMap((row) => {
    const values = definedValues(row.points);
    if (values.length === 0) return [];
    return [{ ...row, axis: yAxis(values, row.tickStep) }];
  });
  if (rows.length === 0) {
    return null;
  }
  const volatilityMissing = !rows.some((row) => row.id === "volatility");

  // Stacked charts share one plot origin, so the x axes line up whatever each y label's width.
  const left = Math.max(...rows.map((row) => axisLeftMargin(row.axis.ticks.map(row.format))));

  return (
    <div className="flex flex-col gap-4" data-testid="option-series-history">
      {rows.map((row, rowIndex) => {
        const point = row.points[shownIndex(row.points, hovered)];
        const showAxis = rowIndex === rows.length - 1;
        return (
          <div key={row.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-4"
                  style={{ backgroundColor: row.stroke }}
                />
                {row.label}
              </span>
              <span className="text-muted-foreground font-mono tabular-nums">
                {point ? `${formatSessionDate(point.session)} · ` : ""}
                <span className="text-foreground">
                  {point?.value == null ? labels.noValue : row.format(point.value)}
                </span>
              </span>
            </div>
            <ParentSize style={{ height: rowHeight(showAxis) }}>
              {({ width }) =>
                width > 0 ? (
                  <Chart
                    width={width}
                    row={row}
                    left={left}
                    hovered={hovered}
                    showAxis={showAxis}
                    onHover={setHovered}
                  />
                ) : null
              }
            </ParentSize>
          </div>
        );
      })}
      {volatilityMissing ? (
        <p className="text-muted-foreground text-xs" data-testid="option-series-history-no-iv">
          {labels.volatilityUnavailable}
        </p>
      ) : null}
    </div>
  );
}
