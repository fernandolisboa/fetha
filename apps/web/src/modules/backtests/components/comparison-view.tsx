import type { ReactNode } from "react";
import Link from "next/link";
import type { BacktestMetrics, BacktestRun } from "@fetha/engine";

import { formatBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";
import { cn } from "@/lib/utils";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { Panel } from "@/modules/shell";

import { alignWindows, cumulativeReturns, returnTone, type ComparedRun } from "../comparison";
import { t } from "../strings";
import { ComparisonChart } from "./comparison-chart";
import { limitModeLabel } from "./report-panel";

const seriesColors = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const toneClass = { up: "text-up", down: "text-down", flat: "" } as const;

function seriesColor(index: number): string {
  return seriesColors[index] ?? "var(--chart-stroke)";
}

function displayDate(session: string): string {
  return formatDate(sessionDateToDisplayDate(session));
}

function percentOrDash(value: BacktestMetrics["cagr"]): string {
  return value ? formatPercent(value) : "—";
}

function decimalOrDash(value: BacktestMetrics["sharpe"]): string {
  return value ? formatDecimal(value) : "—";
}

const metricRows: { label: string; render: (m: BacktestMetrics) => ReactNode }[] = [
  { label: t.report.metrics.totalReturn, render: (m) => formatPercent(m.totalReturn) },
  { label: t.report.metrics.cagr, render: (m) => percentOrDash(m.cagr) },
  { label: t.report.metrics.maxDrawdown, render: (m) => formatPercent(m.maxDrawdown) },
  { label: t.report.metrics.sharpe, render: (m) => decimalOrDash(m.sharpe) },
  { label: t.report.metrics.winRate, render: (m) => percentOrDash(m.winRate) },
  { label: t.report.metrics.profitFactor, render: (m) => decimalOrDash(m.profitFactor) },
  { label: t.report.metrics.exposure, render: (m) => formatPercent(m.exposure) },
  { label: t.report.metrics.operations, render: (m) => String(m.operations) },
  { label: t.report.metrics.sessions, render: (m) => String(m.sessions) },
  { label: t.report.metrics.fees, render: (m) => formatBRL(m.fees) },
  { label: t.report.metrics.taxes, render: (m) => formatBRL(m.taxes) },
  { label: t.report.metrics.slippage, render: (m) => formatBRL(m.slippage) },
];

function RunHeaders({ runs }: { runs: ComparedRun[] }) {
  return (
    <>
      {runs.map((run, index) => (
        <th key={run.id} scope="col" className="py-2 pl-4 text-right font-normal normal-case">
          <Link
            href={run.href}
            className="text-foreground inline-flex items-center gap-2 underline-offset-4 hover:underline"
          >
            <span
              aria-hidden
              className="inline-block h-0.5 w-3"
              style={{ backgroundColor: seriesColor(index) }}
            />
            {run.label}
          </Link>
        </th>
      ))}
    </>
  );
}

function ComparisonTable({
  firstColumn,
  runs,
  children,
}: {
  firstColumn: string;
  runs: ComparedRun[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
            <th scope="col" className="py-2 font-normal">
              {firstColumn}
            </th>
            <RunHeaders runs={runs} />
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function ComparisonView({ runs }: { runs: ComparedRun[] }) {
  const setup = t.compare.setup;
  const samePeriod =
    new Set(runs.map(({ result }) => `${result.config.period.from}|${result.config.period.to}`))
      .size <= 1;
  const windowRows = alignWindows(runs.map((run) => run.result));

  const setupRows: { label: string; render: (run: BacktestRun) => ReactNode }[] = [
    {
      label: setup.period,
      render: (run) =>
        `${displayDate(run.config.period.from)} – ${displayDate(run.config.period.to)}`,
    },
    { label: setup.universe, render: (run) => run.config.universe.join(", ") },
    { label: setup.capital, render: (run) => formatBRL(run.config.initialCapital) },
    { label: setup.limits, render: (run) => limitModeLabel(run.config.limits) },
    {
      label: setup.walkForward,
      render: (run) =>
        run.config.walkForward
          ? t.walkForward.windowLength.replace(
              "{sessions}",
              String(run.config.walkForward.windowSessions),
            )
          : setup.walkForwardNone,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Panel title={setup.title}>
        <ComparisonTable firstColumn="" runs={runs}>
          {setupRows.map((row) => (
            <tr key={row.label} className="border-line-soft border-b">
              <th scope="row" className="text-muted-foreground py-2 font-normal">
                {row.label}
              </th>
              {runs.map((run) => (
                <td key={run.id} className="py-2 pl-4 text-right font-mono tabular-nums">
                  {row.render(run.result)}
                </td>
              ))}
            </tr>
          ))}
        </ComparisonTable>
        {samePeriod ? null : <p className="text-warning text-xs">{t.compare.differentPeriods}</p>}
      </Panel>

      <Panel title={t.compare.equityTitle} subtitle={t.compare.equitySubtitle}>
        <ComparisonChart
          series={runs.map((run, index) => ({
            id: run.id,
            label: run.label,
            color: seriesColor(index),
            points: cumulativeReturns(run.result.config.initialCapital, run.result.equityCurve),
          }))}
        />
      </Panel>

      <Panel title={t.compare.metricsTitle}>
        <ComparisonTable firstColumn={t.compare.metric} runs={runs}>
          {metricRows.map((row) => (
            <tr key={row.label} className="border-line-soft border-b">
              <th scope="row" className="text-muted-foreground py-2 font-normal">
                {row.label}
              </th>
              {runs.map((run) => (
                <td key={run.id} className="py-2 pl-4 text-right font-mono tabular-nums">
                  {row.render(run.result.metrics)}
                </td>
              ))}
            </tr>
          ))}
        </ComparisonTable>
      </Panel>

      <Panel title={t.compare.windowsTitle} subtitle={t.compare.windowsSubtitle}>
        {windowRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.compare.windowsNone}</p>
        ) : (
          <ComparisonTable firstColumn={t.walkForward.columns.window} runs={runs}>
            {windowRows.map((row) => (
              <tr key={`${row.from}|${row.to}`} className="border-line-soft border-b">
                <th
                  scope="row"
                  className="py-2 font-mono font-normal whitespace-nowrap tabular-nums"
                >
                  {displayDate(row.from)} – {displayDate(row.to)}
                </th>
                {row.cells.map((cell, index) => (
                  <td
                    key={runs[index]?.id ?? index}
                    className={cn(
                      "py-2 pl-4 text-right font-mono tabular-nums",
                      cell
                        ? toneClass[returnTone(cell.metrics.totalReturn)]
                        : "text-muted-foreground",
                    )}
                  >
                    {cell ? formatPercent(cell.metrics.totalReturn) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </ComparisonTable>
        )}
      </Panel>
    </div>
  );
}
