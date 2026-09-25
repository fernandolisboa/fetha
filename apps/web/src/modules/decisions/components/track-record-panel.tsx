"use client";

import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { decimalStringSchema, type DecimalString } from "@fetha/contracts";

import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";
import { Panel } from "@/modules/shell";
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

function PnlOverTimeChart({ width, points }: { width: number; points: TrackRecordStats["pnlOverTime"] }) {
  const height = Math.round((width * 200) / 320);
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const plot = points.map((point) => ({ at: point.scoredAt, value: Number(point.normalizedPnl) }));
  const xScale = scaleTime({
    domain: [plot[0]?.at ?? new Date(), plot.at(-1)?.at ?? new Date()],
    range: [0, innerWidth],
  });
  const maxAbs = Math.max(0.01, ...plot.map((point) => Math.abs(point.value)));
  const yScale = scaleLinear({ domain: [-maxAbs, maxAbs], range: [innerHeight, 0] });

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
          tickFormat={(value) => formatDate(value as Date)}
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
                <TableHead className="text-right">{t.trackRecord.calibrationHitRateHeader}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.confidenceBuckets.map((bucket) => (
                <TableRow key={bucket.bucket}>
                  <TableCell className="font-mono">{bucket.bucket}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{bucket.count}</TableCell>
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
          <ParentSize>
            {({ width }) => (width > 0 ? <PnlOverTimeChart width={width} points={stats.pnlOverTime} /> : null)}
          </ParentSize>
        )}
      </Panel>

      <Panel title={t.trackRecord.aiCalibrationTitle}>
        <p className="text-muted-foreground text-sm">{t.trackRecord.aiCalibrationEmpty}</p>
      </Panel>
    </div>
  );
}
