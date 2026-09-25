import type { BacktestMetrics, BacktestRun } from "@fetha/engine";

import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";
import { cn } from "@/lib/utils";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { Panel } from "@/modules/shell";

import { returnTone } from "../comparison";
import { t } from "../strings";

const toneClass = { up: "text-up", down: "text-down", flat: "" } as const;

function MetricCells({ metrics }: { metrics: BacktestMetrics }) {
  return (
    <>
      <td className="py-2 text-right font-mono tabular-nums">{metrics.sessions}</td>
      <td className="py-2 text-right font-mono tabular-nums">{metrics.operations}</td>
      <td
        className={cn(
          "py-2 text-right font-mono tabular-nums",
          toneClass[returnTone(metrics.totalReturn)],
        )}
      >
        {formatPercent(metrics.totalReturn)}
      </td>
      <td className="py-2 text-right font-mono tabular-nums">
        {formatPercent(metrics.maxDrawdown)}
      </td>
      <td className="py-2 text-right font-mono tabular-nums">
        {metrics.winRate ? formatPercent(metrics.winRate) : "—"}
      </td>
      <td className="py-2 text-right font-mono tabular-nums">
        {metrics.profitFactor ? formatDecimal(metrics.profitFactor) : "—"}
      </td>
      <td className="py-2 text-right font-mono tabular-nums">{formatPercent(metrics.exposure)}</td>
    </>
  );
}

export function WalkForwardTable({ run }: { run: BacktestRun }) {
  const columns = t.walkForward.columns;
  const windowSessions = run.config.walkForward?.windowSessions;
  return (
    <Panel
      title={t.walkForward.title}
      subtitle={
        windowSessions
          ? `${t.walkForward.windowLength.replace("{sessions}", String(windowSessions))}. ${t.walkForward.subtitle}`
          : undefined
      }
    >
      {run.walkForward === null ? (
        <p className="text-muted-foreground text-sm">{t.walkForward.unavailable}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
                <th className="py-2 font-normal">{columns.window}</th>
                <th className="py-2 text-right font-normal">{columns.sessions}</th>
                <th className="py-2 text-right font-normal">{columns.operations}</th>
                <th className="py-2 text-right font-normal">{columns.totalReturn}</th>
                <th className="py-2 text-right font-normal">{columns.maxDrawdown}</th>
                <th className="py-2 text-right font-normal">{columns.winRate}</th>
                <th className="py-2 text-right font-normal">{columns.profitFactor}</th>
                <th className="py-2 text-right font-normal">{columns.exposure}</th>
              </tr>
            </thead>
            <tbody>
              {run.walkForward.map((window) => (
                <tr key={window.from} className="border-line-soft border-b">
                  <td className="py-2 font-mono whitespace-nowrap tabular-nums">
                    {formatDate(sessionDateToDisplayDate(window.from))} –{" "}
                    {formatDate(sessionDateToDisplayDate(window.to))}
                  </td>
                  <MetricCells metrics={window.metrics} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-line border-t font-medium">
                <td className="py-2">{t.walkForward.wholePeriod}</td>
                <MetricCells metrics={run.metrics} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}
