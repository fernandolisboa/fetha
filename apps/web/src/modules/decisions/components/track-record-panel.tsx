"use client";

import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Circle } from "@visx/shape";
import { decimalStringSchema, type DecimalString } from "@fetha/contracts";

import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";
import { Panel } from "@/modules/shell/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { TrackRecordStats } from "../decision-scores-repository";
import { t } from "../strings";

const MARGIN = { top: 12, right: 12, bottom: 28, left: 48 };

function ratio(numerator: number, denominator: number): DecimalString {
  return decimalStringSchema.parse((numerator / denominator).toFixed(4));
}

// A session-date string ("2026-10-17") to a stable, timezone-immune `Date`
// for `scaleTime`'s domain: midday UTC so this chart's ordering can never
// shift a point to the adjacent calendar day the way midnight-UTC would near
// the São Paulo/UTC boundary (the same reasoning `journal-entry.tsx`'s own
// `formatSessionDate` documents for display).
function sessionDateToChartDate(session: string): Date {
  return new Date(`${session}T12:00:00.000Z`);
}

function formatSessionTick(session: string): string {
  const [, month, day] = session.split("-");
  return `${day ?? ""}/${month ?? ""}`;
}

// `scaleTime` cannot usefully interpolate a `LinePath` across a domain whose
// start and end are the same instant (#29 fix-web item 9): a single scored
// decision is the obvious case, but several decisions sharing one horizon
// date collapse the domain the same way, not just a `plot.length === 1`
// check (round 3 item 8).
export function isDegenerateChartDomain(points: readonly { at: Date }[]): boolean {
  if (points.length <= 1) return true;
  const first = points[0]?.at.getTime();
  return points.every((point) => point.at.getTime() === first);
}

function PnlOverTimeChart({
  width,
  points,
}: {
  width: number;
  points: TrackRecordStats["pnlOverTime"];
}) {
  const height = Math.round((width * 200) / 320);
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const plot = points.map((point) => ({
    horizon: point.horizon,
    at: sessionDateToChartDate(point.horizon),
    value: Number(point.normalizedPnl),
  }));
  const maxAbs = Math.max(0.01, ...plot.map((point) => Math.abs(point.value)));
  const yScale = scaleLinear({ domain: [-maxAbs, maxAbs], range: [innerHeight, 0] });

  // A single scored decision, or several sharing one horizon date, has no
  // time span to plot a line over — the domain start and end collapse to the
  // same instant, which `scaleTime` cannot usefully interpolate a `LinePath`
  // across (#29 fix-web item 9, widened by round 3 item 8 beyond just
  // `plot.length === 1`). Every point that shares that instant is drawn as
  // its own dot at mid-width instead of a zero-length line.
  if (isDegenerateChartDomain(plot)) {
    return (
      <svg width={width} height={height} role="img" aria-label={t.trackRecord.pnlOverTimeTitle}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {plot.map((point, index) => (
            <Circle
              key={`${point.horizon}-${String(index)}`}
              cx={innerWidth / 2}
              cy={yScale(point.value)}
              r={3}
              fill="var(--chart-stroke)"
            />
          ))}
          <AxisLeft
            scale={yScale}
            stroke="var(--line-soft)"
            tickStroke="var(--line-soft)"
            tickFormat={(value) => `${String(Math.round(Number(value) * 100))}%`}
            tickLabelProps={() => ({
              fill: "var(--muted)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
            })}
          />
        </Group>
      </svg>
    );
  }

  const xScale = scaleTime({
    domain: [plot[0]?.at ?? new Date(), plot.at(-1)?.at ?? new Date()],
    range: [0, innerWidth],
  });

  return (
    <svg width={width} height={height} role="img" aria-label={t.trackRecord.pnlOverTimeTitle}>
      <Group left={MARGIN.left} top={MARGIN.top}>
        <LinePath
          data={plot}
          x={(point) => xScale(point.at)}
          y={(point) => yScale(point.value)}
          stroke="var(--chart-stroke)"
          strokeWidth={1.5}
        />
        <AxisBottom
          top={innerHeight}
          scale={xScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickFormat={(value) => formatSessionTick((value as Date).toISOString().slice(0, 10))}
          tickLabelProps={() => ({
            fill: "var(--muted)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          })}
        />
        <AxisLeft
          scale={yScale}
          stroke="var(--line-soft)"
          tickStroke="var(--line-soft)"
          tickFormat={(value) => `${String(Math.round(Number(value) * 100))}%`}
          tickLabelProps={() => ({
            fill: "var(--muted)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          })}
        />
      </Group>
    </svg>
  );
}

// The track record's own panel (brief item 4): hit rate, calibration (mean
// Brier and stated-confidence buckets against realized hit rate), and
// normalized P&L over time as a `visx` line — `--chart-stroke`, no dual
// axes, no pies (DESIGN.md). The AI calibration slot stays an empty state
// until analyses exist (#28).
export function TrackRecordPanel({ stats }: { stats: TrackRecordStats }) {
  return (
    <div className="flex flex-col gap-[14px]">
      <Panel title={t.trackRecord.hitRateLabel}>
        {stats.claimsScoredCount === 0 ? (
          <p className="text-muted-foreground text-sm">{t.trackRecord.hitRateEmpty}</p>
        ) : (
          <p className="font-mono text-[22px] tabular-nums">
            {formatPercent(ratio(stats.claimsHeldCount, stats.claimsScoredCount))}
          </p>
        )}
        {stats.claimsScoredCount > 0 ? (
          <p className="text-muted-foreground text-[12px]">
            {t.trackRecord.hitRateSentence(stats.claimsHeldCount, stats.claimsScoredCount)}
          </p>
        ) : null}
      </Panel>

      <Panel title={t.trackRecord.calibrationTitle}>
        {stats.meanBrier !== null ? (
          <p className="text-[12px]">
            {t.trackRecord.meanBrierLabel}:{" "}
            <span className="font-mono tabular-nums">{formatDecimal(stats.meanBrier, 4)}</span>
          </p>
        ) : null}
        {stats.confidenceBuckets.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.trackRecord.calibrationEmpty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.trackRecord.calibrationBucketHeader}</TableHead>
                <TableHead className="text-right">{t.trackRecord.calibrationCountHeader}</TableHead>
                <TableHead className="text-right">
                  {t.trackRecord.calibrationHitRateHeader}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.confidenceBuckets.map((bucket) => (
                <TableRow key={bucket.bucket}>
                  <TableCell className="font-mono">{bucket.bucket}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {bucket.count}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPercent(ratio(bucket.heldCount, bucket.count))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel title={t.trackRecord.pnlOverTimeTitle}>
        {stats.pnlOverTime.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.trackRecord.pnlOverTimeEmpty}</p>
        ) : (
          <ParentSize style={{ height: "auto", aspectRatio: "320 / 200" }}>
            {({ width }) =>
              width > 0 ? <PnlOverTimeChart width={width} points={stats.pnlOverTime} /> : null
            }
          </ParentSize>
        )}
      </Panel>

      <Panel title={t.trackRecord.aiCalibrationTitle}>
        <p className="text-muted-foreground text-sm">{t.trackRecord.aiCalibrationEmpty}</p>
      </Panel>
    </div>
  );
}
