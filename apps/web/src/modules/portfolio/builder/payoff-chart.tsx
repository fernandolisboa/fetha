"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, Line, LinePath } from "@visx/shape";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { centavosSchema, type DecimalString } from "@fetha/contracts";
import type { OperationPricing, PayoffPoint } from "@fetha/engine";

import { ticksThatFit } from "@/lib/chart-ticks";
import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";

import { t } from "../strings";
import {
  formatAxisPrice,
  guideLabelY,
  guideVisible,
  focusWindow,
  nearestIndex,
  nearestStrikeAtPixel,
  pnlAt,
  pnlNowAt,
  staggeredBelow,
} from "./payoff-chart-layout";

// Drag-to-adjust's own handle on the payoff chart's price axis (ticket #380): the caller (the
// plan screen) supplies one per leg, already resolved to this leg's own listed strikes — the
// chart only ever draws and drags pixels, every strike/ticker lookup and every server round trip
// stays the caller's own (ADR-0013-adjacent separation: this chart has no notion of a "leg" or a
// "plan"). `ticks` draws every listed strike (traded or not) as a mark along the axis; a drag or
// an arrow key only ever snaps to the traded ones.
export interface PayoffStrikeTick {
  value: number;
  traded: boolean;
}

export interface PayoffStrikeHandle {
  key: string;
  ariaLabel: string;
  valueText: string;
  value: number;
  min: number;
  max: number;
  ticks: readonly PayoffStrikeTick[];
  // Called continuously while dragging, only when the nearest traded strike under the pointer
  // changes (never on every pixel): the caller's own client-side preview.
  onPreview: (value: number) => void;
  // Called once, on release: the caller's own server reprice.
  onCommit: (value: number) => void;
  // The ← → buttons' own step, reused verbatim for the handle's own arrow keys (never a second
  // implementation of "the next traded strike").
  onStep: (direction: 1 | -1) => void;
}

const MARGIN = { top: 12, right: 28, bottom: 28 };
// Every theme's mono font advances 0.6em (6.6px at 11px); 7px leaves room for renderers that draw it
// wider, as the CI runner's headless Chromium does. The left margin fits the widest y tick label.
const TICK_CHAR_WIDTH = 7;
const TICK_GAP = 12;
// A pt-BR axis price ("22,5") with room between neighbours.
const X_TICK_SPACING = 56;
const LABEL_LINE = 12;
const BREAK_EVEN_LABEL_GAP = 6;

type PlotPoint = { underlying: number; pnl: number };

// `computePayoffProfile` (packages/engine/src/internal/price-operation.ts) already samples
// each leg's strike and each break-even alongside 0.8/1/1.2 of spot, sorted ascending and
// de-duplicated: every kink the line needs to be honest is a real
// engine point, so the chart draws them as given and never fabricates a value between them. The
// T+0 curve (ADR-0077) adds 41 samples one percent of spot apart, close enough that its straight
// segments stay within a pixel of the model's curve.
function plotPoints(points: PayoffPoint[]): PlotPoint[] {
  return points.map((point) => ({ underlying: Number(point.underlying), pnl: point.pnl }));
}

function formatAxisBRL(value: number): string {
  return formatBRL(centavosSchema.parse(Math.round(value)));
}

// DESIGN.md's 800×340 aspect, capped so a wide monitor gets a wider chart, not a taller one
// that pushes the stat blocks below the fold, and floored so a phone still gets a readable one.
const MAX_HEIGHT = 420;
const MIN_HEIGHT = 220;
// An 11px label plus room for d3 returning more ticks than asked when it rounds to a nicer step.
const Y_TICK_SPACING = 32;

type Extremes = { maxGain?: OperationPricing["maxGain"]; maxLoss?: OperationPricing["maxLoss"] };

function pnlColor(pnl: number): string {
  return pnl > 0 ? "var(--up)" : pnl < 0 ? "var(--down)" : "var(--ink)";
}

const labelText = {
  fill: "var(--muted)",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
} as const;

function Chart({
  width,
  points,
  pointsNow,
  spot,
  breakEvens,
  extremes,
  framed,
  handles,
}: {
  width: number;
  points: PayoffPoint[];
  pointsNow: PayoffPoint[] | null;
  spot: number;
  breakEvens: DecimalString[];
  extremes: Extremes;
  framed: boolean;
  handles?: readonly PayoffStrikeHandle[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [dragPixel, setDragPixel] = useState<Record<string, number>>({});
  const dragRef = useRef<Map<string, { pointerId: number; snapped: number | null }>>(new Map());
  const plotRectRef = useRef<SVGRectElement | null>(null);
  const clipId = `payoff-${useId().replace(/[^\w-]/g, "")}`;
  const height = Math.max(MIN_HEIGHT, Math.min(Math.round((width * 340) / 800), MAX_HEIGHT));
  const innerHeight = height - MARGIN.top - MARGIN.bottom;
  const yTicks = ticksThatFit(innerHeight, Y_TICK_SPACING, 10);

  const plot = plotPoints(points);
  const plotNow = pointsNow ? plotPoints(pointsNow) : [];
  const underlyings = plot.map((point) => point.underlying);
  const [xMin, xMax] = framed
    ? focusWindow(plot, spot, breakEvens.map(Number))
    : [Math.min(...underlyings), Math.max(...underlyings)];
  const shown = plot
    .map((point, index) => ({ ...point, index }))
    .filter((point) => point.underlying >= xMin && point.underlying <= xMax);
  const shownNow = plotNow.filter((point) => point.underlying >= xMin && point.underlying <= xMax);
  const pnls = [
    ...shown.map((point) => point.pnl),
    pnlAt(plot, xMin),
    pnlAt(plot, xMax),
    ...shownNow.map((point) => point.pnl),
    ...(plotNow.length > 0 ? [pnlAt(plotNow, xMin), pnlAt(plotNow, xMax)] : []),
  ];

  const maxAbsPnl = Math.max(1, ...pnls.map((pnl) => Math.abs(pnl)));
  const yScale = scaleLinear({
    domain: [-maxAbsPnl, maxAbsPnl],
    range: [innerHeight, 0],
  });
  const left =
    Math.ceil(
      Math.max(...yScale.ticks(yTicks).map((tick) => formatAxisBRL(tick).length)) * TICK_CHAR_WIDTH,
    ) + TICK_GAP;
  const innerWidth = Math.max(1, width - left - MARGIN.right);
  const xScale = scaleLinear({
    domain: [xMin, xMax],
    range: [0, innerWidth],
  });
  const xTicks = ticksThatFit(innerWidth, X_TICK_SPACING, 10);

  const breakEvenXs = breakEvens.map((breakEven) => xScale(Number(breakEven)));
  const breakEvenWidths = breakEvens.map(
    (breakEven) => formatDecimal(breakEven).length * TICK_CHAR_WIDTH + BREAK_EVEN_LABEL_GAP,
  );
  const breakEvenBelow = staggeredBelow(breakEvenXs, Math.max(0, ...breakEvenWidths));

  const guides = [
    { side: "gain" as const, value: extremes.maxGain, pnl: (value: number) => value },
    { side: "loss" as const, value: extremes.maxLoss, pnl: (value: number) => -value },
  ].flatMap(({ side, value, pnl }) =>
    value === undefined || value === "unbounded" || !guideVisible(pnl(value), maxAbsPnl)
      ? []
      : [
          {
            side,
            y: yScale(pnl(value)),
            label: (side === "gain"
              ? t.builder.payoffChart.maxGain
              : t.builder.payoffChart.maxLoss)(formatBRL(value)),
          },
        ],
  );

  // A re-price can move the window under a resting pointer; a sample it left is not read out.
  const onChart = hovered !== null && shown.some((sample) => sample.index === hovered);
  const point = onChart ? plot[hovered] : undefined;
  const source = onChart ? points[hovered] : undefined;
  const hoveredX = point ? xScale(point.underlying) : null;
  const sourceNow = source ? pnlNowAt(pointsNow, source.underlying) : null;

  function onPointer(event: ReactPointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const nearest = nearestIndex(
      shown.map((point) => point.underlying),
      xScale.invert(event.clientX - box.left),
    );
    setHovered(nearest === null ? null : (shown[nearest]?.index ?? null));
  }

  // Drag-to-adjust's own handle (ticket #380): `pixelFromClientX` shares the same
  // group-relative coordinate `onPointer` above already reads the hover readout from
  // (`getBoundingClientRect` on the same invisible plot rect), clamped to the plot's own width so
  // a handle dragged past either edge stops at it rather than reporting a price off the axis.
  function pixelFromClientX(clientX: number): number {
    const box = plotRectRef.current?.getBoundingClientRect();
    if (!box) return 0;
    return Math.max(0, Math.min(innerWidth, clientX - box.left));
  }

  function tradedValuesOf(handle: PayoffStrikeHandle): number[] {
    return handle.ticks.filter((tick) => tick.traded).map((tick) => tick.value);
  }

  function onHandlePointerDown(handle: PayoffStrikeHandle, event: ReactPointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current.set(handle.key, { pointerId: event.pointerId, snapped: null });
    setDragPixel((prev) => ({ ...prev, [handle.key]: xScale(handle.value) }));
  }

  function onHandlePointerMove(handle: PayoffStrikeHandle, event: ReactPointerEvent) {
    const state = dragRef.current.get(handle.key);
    if (!state || state.pointerId !== event.pointerId) return;
    const pixelX = pixelFromClientX(event.clientX);
    setDragPixel((prev) => ({ ...prev, [handle.key]: pixelX }));
    const snapped = nearestStrikeAtPixel(xScale, pixelX, tradedValuesOf(handle));
    if (snapped !== null && snapped !== state.snapped) {
      dragRef.current.set(handle.key, { ...state, snapped });
      handle.onPreview(snapped);
    }
  }

  function onHandlePointerUp(handle: PayoffStrikeHandle, event: ReactPointerEvent) {
    const state = dragRef.current.get(handle.key);
    dragRef.current.delete(handle.key);
    setDragPixel((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => key !== handle.key)),
    );
    if (state?.snapped !== null && state?.snapped !== undefined) {
      handle.onCommit(state.snapped);
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onHandleKeyDown(handle: PayoffStrikeHandle, event: ReactKeyboardEvent) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      handle.onStep(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      handle.onStep(-1);
    }
  }

  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={
          plotNow.length > 0 ? t.builder.payoffChart.pnlWithToday : t.builder.payoffChart.pnl
        }
      >
        <defs>
          <clipPath id={clipId}>
            <rect y={-2} width={innerWidth} height={innerHeight + 4} />
          </clipPath>
        </defs>
        <Group left={left} top={MARGIN.top}>
          <Line
            from={{ x: 0, y: yScale(0) }}
            to={{ x: innerWidth, y: yScale(0) }}
            stroke="var(--muted)"
            strokeDasharray="4,4"
          />
          {guides.map((guide) => (
            <Group key={guide.side}>
              <Line
                from={{ x: 0, y: guide.y }}
                to={{ x: innerWidth, y: guide.y }}
                stroke={guide.side === "gain" ? "var(--up)" : "var(--down)"}
                strokeOpacity={0.5}
                strokeDasharray="1,3"
              />
              <text
                x={4}
                y={guideLabelY(guide.y, guide.side, innerHeight, LABEL_LINE)}
                {...labelText}
                fill={guide.side === "gain" ? "var(--up)" : "var(--down)"}
              >
                {guide.label}
              </text>
            </Group>
          ))}
          <Line
            from={{ x: xScale(spot), y: 0 }}
            to={{ x: xScale(spot), y: innerHeight }}
            stroke="var(--ink)"
            strokeDasharray="2,2"
          />
          <Group clipPath={`url(#${clipId})`}>
            <AreaClosed
              data={plot}
              x={(point) => xScale(point.underlying)}
              y={(point) => (point.pnl >= 0 ? yScale(point.pnl) : yScale(0))}
              yScale={yScale}
              y0={yScale(0)}
              fill="var(--up)"
              opacity={0.12}
            />
            <AreaClosed
              data={plot}
              x={(point) => xScale(point.underlying)}
              y={(point) => (point.pnl < 0 ? yScale(point.pnl) : yScale(0))}
              yScale={yScale}
              y0={yScale(0)}
              fill="var(--down)"
              opacity={0.12}
            />
            {plotNow.length > 0 ? (
              <LinePath
                data={plotNow}
                x={(point) => xScale(point.underlying)}
                y={(point) => yScale(point.pnl)}
                stroke="var(--muted)"
                strokeWidth={1}
                data-testid="payoff-now-line"
              />
            ) : null}
            <LinePath
              data={plot}
              x={(point) => xScale(point.underlying)}
              y={(point) => yScale(point.pnl)}
              stroke="var(--chart-stroke)"
              strokeWidth={1.5}
            />
          </Group>
          {breakEvens.map((breakEven, index) => {
            const x = breakEvenXs[index] ?? 0;
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
                  y={breakEvenBelow[index] ? y + 18 : y - 10}
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
          {point && hoveredX !== null ? (
            <Group>
              <Line
                from={{ x: hoveredX, y: 0 }}
                to={{ x: hoveredX, y: innerHeight }}
                stroke="var(--line)"
              />
              {sourceNow !== null ? (
                <circle
                  cx={hoveredX}
                  cy={yScale(sourceNow)}
                  r={3}
                  fill="var(--muted)"
                  stroke="var(--surface)"
                  strokeWidth={1.5}
                />
              ) : null}
              <circle
                cx={hoveredX}
                cy={yScale(point.pnl)}
                r={4}
                fill="var(--chart-stroke)"
                stroke="var(--surface)"
                strokeWidth={1.5}
              />
            </Group>
          ) : null}
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            stroke="var(--line-soft)"
            tickStroke="var(--line-soft)"
            tickFormat={(value) => formatAxisPrice(Number(value))}
            numTicks={xTicks}
            tickLabelProps={() => ({ ...labelText, textAnchor: "middle" })}
          />
          <AxisLeft
            scale={yScale}
            stroke="var(--line-soft)"
            tickStroke="var(--line-soft)"
            tickFormat={(value) => formatAxisBRL(Number(value))}
            numTicks={yTicks}
            tickLabelProps={() => ({
              ...labelText,
              textAnchor: "end",
              dx: "-0.25em",
              dy: "0.25em",
            })}
          />
          <rect
            ref={plotRectRef}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            style={{ touchAction: "pan-y" }}
            // A touch pointer leaves right after it lifts; the tapped sample stays until the next tap.
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setHovered(null);
            }}
          />
          {handles?.map((handle) => {
            const dragging = handle.key in dragPixel;
            const cx = dragPixel[handle.key] ?? xScale(handle.value);
            return (
              <Group key={handle.key}>
                {handle.ticks.map((tick) => (
                  <Line
                    key={tick.value}
                    from={{ x: xScale(tick.value), y: innerHeight - 5 }}
                    to={{ x: xScale(tick.value), y: innerHeight + 5 }}
                    stroke={tick.traded ? "var(--line)" : "var(--faint)"}
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                ))}
                <circle
                  cx={cx}
                  cy={innerHeight}
                  r={12}
                  fill="var(--accent)"
                  fillOpacity={dragging ? 0.9 : 0.7}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  role="slider"
                  tabIndex={0}
                  aria-label={handle.ariaLabel}
                  aria-valuemin={handle.min}
                  aria-valuemax={handle.max}
                  aria-valuenow={handle.value}
                  aria-valuetext={handle.valueText}
                  className="transition-[cx] duration-[120ms] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] motion-reduce:transition-none"
                  style={{
                    cursor: "ew-resize",
                    touchAction: "none",
                    transitionDuration: dragging ? "0ms" : undefined,
                  }}
                  onPointerDown={(event) => {
                    onHandlePointerDown(handle, event);
                  }}
                  onPointerMove={(event) => {
                    onHandlePointerMove(handle, event);
                  }}
                  onPointerUp={(event) => {
                    onHandlePointerUp(handle, event);
                  }}
                  onKeyDown={(event) => {
                    onHandleKeyDown(handle, event);
                  }}
                />
              </Group>
            );
          })}
        </Group>
      </svg>
      {source && hoveredX !== null ? (
        <div
          className="border-border bg-card pointer-events-none absolute rounded-[var(--radius)] border px-2 py-1 text-xs"
          style={{
            ...(hoveredX + left > width / 2
              ? { right: width - (hoveredX + left) + 8 }
              : { left: hoveredX + left + 8 }),
            // On the half of the plot away from the hovered point, so it never hides the line there.
            ...(point && yScale(point.pnl) < innerHeight / 2
              ? { bottom: MARGIN.bottom + 4 }
              : { top: MARGIN.top + 4 }),
          }}
          data-testid="payoff-readout"
        >
          <p className="text-muted-foreground">
            {t.builder.payoffChart.at(formatPriceBRL(source.underlying))}
          </p>
          <p className="font-mono tabular-nums" style={{ color: pnlColor(source.pnl) }}>
            {formatBRL(source.pnl)}
          </p>
          {sourceNow !== null ? (
            <p className="text-muted-foreground" data-testid="payoff-readout-now">
              {t.builder.payoffChart.today}{" "}
              <span className="font-mono tabular-nums" style={{ color: pnlColor(sourceNow) }}>
                {formatBRL(sourceNow)}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LegendSwatch({
  dash,
  color,
  width = 1.5,
}: {
  dash?: string;
  color: string;
  width?: number;
}) {
  return (
    <svg width={16} height={8} aria-hidden="true" className="shrink-0">
      <line
        x1={0}
        y1={4}
        x2={16}
        y2={4}
        stroke={color}
        strokeWidth={width}
        strokeDasharray={dash}
      />
    </svg>
  );
}

function Legend({ spotLabel, today }: { spotLabel: string | undefined; today: boolean }) {
  const labels = t.builder.payoffChart.legend;
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
      <li className="flex items-center gap-1.5">
        <LegendSwatch color="var(--chart-stroke)" />
        {labels.line}
      </li>
      {today ? (
        <li className="flex items-center gap-1.5">
          <LegendSwatch color="var(--muted)" width={1} />
          {labels.today}
        </li>
      ) : null}
      {spotLabel !== undefined ? (
        <>
          <li className="flex items-center gap-1.5 font-mono tabular-nums">
            <LegendSwatch color="var(--ink)" dash="2,2" />
            {spotLabel}
          </li>
          <li className="flex items-center gap-1.5">
            <svg width={10} height={10} aria-hidden="true" className="shrink-0">
              <circle
                cx={5}
                cy={5}
                r={3.5}
                fill="var(--surface)"
                stroke="var(--ink)"
                strokeWidth={1.5}
              />
            </svg>
            {labels.breakEven}
          </li>
        </>
      ) : null}
    </ul>
  );
}

export function PayoffChart({
  points,
  pointsNow = null,
  spot,
  breakEvens,
  maxGain,
  maxLoss,
  spotLabel,
  framed = false,
  handles,
}: {
  points: PayoffPoint[];
  pointsNow?: OperationPricing["payoffNow"];
  spot: string;
  breakEvens: DecimalString[];
  maxGain?: OperationPricing["maxGain"];
  maxLoss?: OperationPricing["maxLoss"];
  spotLabel?: string;
  framed?: boolean;
  // Drag-to-adjust's own strike handles (ticket #380), one per leg: absent for every other
  // caller (the builder's own preview, the open-operations payoff), which stays exactly the
  // read-only chart it always was.
  handles?: readonly PayoffStrikeHandle[];
}) {
  if (points.length === 0) {
    return null;
  }
  const chart = (
    <ParentSize
      style={{
        height: "auto",
        aspectRatio: "800 / 340",
        // Without it the min height turns into a min width through the aspect ratio, and the
        // chart overflows a phone-width grid column.
        minWidth: 0,
        minHeight: MIN_HEIGHT,
        maxHeight: MAX_HEIGHT,
      }}
    >
      {({ width }) =>
        width > 0 ? (
          <Chart
            width={width}
            points={points}
            pointsNow={pointsNow}
            spot={Number(spot)}
            breakEvens={breakEvens}
            extremes={{ maxGain, maxLoss }}
            framed={framed}
            handles={handles}
          />
        ) : null
      }
    </ParentSize>
  );
  const today = (pointsNow?.length ?? 0) > 0;
  if (spotLabel === undefined && !today) return chart;
  return (
    <figure className="flex min-w-0 flex-col gap-2" data-testid="payoff-chart">
      <Legend spotLabel={spotLabel} today={today} />
      {chart}
    </figure>
  );
}
