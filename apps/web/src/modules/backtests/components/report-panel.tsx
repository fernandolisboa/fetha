import type { ReactNode } from "react";
import type { BacktestRun, MissedEntryReason, NoteCode, RiskLimit } from "@fetha/engine";

import { formatBRL } from "@/lib/format/brl";
import { formatDate, formatDateTime } from "@/lib/format/date-time";
import { formatPercent } from "@/lib/format/percent";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { Panel } from "@/modules/shell";

import { noteMessage, t } from "../strings";
import { DistributionChart } from "./distribution-chart";
import { DrawdownChart } from "./drawdown-chart";
import { EquityCurveChart } from "./equity-curve-chart";

const missedEntryReasonLabel: Record<MissedEntryReason, string> = {
  no_trades: "sem negócios na sessão",
  limit_breach: "estouro de limite",
  no_series_match: "nenhuma série encontrada",
  degenerate_strikes: "strikes degenerados",
  unsizeable: "não foi possível dimensionar",
};

const riskLimitLabel: Record<RiskLimit, string> = {
  maxLossPerOperation: "perda máxima por operação",
  maxExposurePerOperation: "exposição máxima por operação",
  maxOpenOperations: "operações abertas simultâneas",
  maxPremiumBought: "prêmio máximo comprado",
};

function NotesFor({ run, codes }: { run: BacktestRun; codes: NoteCode[] }) {
  const notes = run.notes.filter((note) => codes.includes(note.code));
  if (notes.length === 0) {
    return null;
  }
  return (
    <ul className="text-muted-foreground mt-1 flex flex-col gap-0.5 text-xs">
      {notes.map((note, index) => (
        <li key={`${note.code}-${String(index)}`}>{noteMessage(note.code)}</li>
      ))}
    </ul>
  );
}

function Stat({ label, value, notes }: { label: string; value: string; notes?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">{label}</p>
      <p className="font-mono text-[18px] tabular-nums">{value}</p>
      {notes}
    </div>
  );
}

const equityDrawdownCodes: NoteCode[] = ["non_positive_equity", "negative_cash"];
const annualizedCodes: NoteCode[] = ["short_window_not_annualized"];
const surfacedCodes: NoteCode[] = [...equityDrawdownCodes, ...annualizedCodes];

export function ReportPanel({ run }: { run: BacktestRun }) {
  const { metrics } = run;
  const returns = run.operations.map(
    (operation) => operation.pnl / Math.max(1, run.config.initialCapital),
  );
  const generalNotes = run.notes.filter((note) => !surfacedCodes.includes(note.code));

  return (
    <div className="flex flex-col gap-6">
      <Panel title={t.report.equityCurve}>
        <EquityCurveChart points={run.equityCurve} />
        <NotesFor run={run} codes={equityDrawdownCodes} />
      </Panel>

      <Panel title={t.report.drawdown}>
        <DrawdownChart points={run.equityCurve} />
      </Panel>

      <Panel title={t.report.distribution}>
        <DistributionChart returns={returns} />
      </Panel>

      <Panel>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label={t.report.metrics.sessions} value={String(metrics.sessions)} />
          <Stat label={t.report.metrics.operations} value={String(metrics.operations)} />
          <Stat label={t.report.metrics.totalReturn} value={formatPercent(metrics.totalReturn)} />
          <Stat
            label={t.report.metrics.cagr}
            value={metrics.cagr ? formatPercent(metrics.cagr) : "—"}
            notes={<NotesFor run={run} codes={annualizedCodes} />}
          />
          <Stat label={t.report.metrics.maxDrawdown} value={formatPercent(metrics.maxDrawdown)} />
          <Stat
            label={t.report.metrics.sharpe}
            value={metrics.sharpe ?? "—"}
            notes={<NotesFor run={run} codes={annualizedCodes} />}
          />
          <Stat
            label={t.report.metrics.winRate}
            value={metrics.winRate ? formatPercent(metrics.winRate) : "—"}
          />
          <Stat label={t.report.metrics.profitFactor} value={metrics.profitFactor ?? "—"} />
          <Stat label={t.report.metrics.exposure} value={formatPercent(metrics.exposure)} />
          <Stat label={t.report.metrics.fees} value={formatBRL(metrics.fees)} />
          <Stat label={t.report.metrics.taxes} value={formatBRL(metrics.taxes)} />
          <Stat label={t.report.metrics.slippage} value={formatBRL(metrics.slippage)} />
        </div>
      </Panel>

      <Panel title={t.report.operationsTable.title}>
        {run.operations.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.report.operationsTable.empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
                <th className="py-2 font-normal">{t.report.operationsTable.columns.underlying}</th>
                <th className="py-2 font-normal">{t.report.operationsTable.columns.openedAt}</th>
                <th className="py-2 font-normal">{t.report.operationsTable.columns.closedAt}</th>
                <th className="py-2 text-right font-normal">
                  {t.report.operationsTable.columns.pnl}
                </th>
              </tr>
            </thead>
            <tbody>
              {run.operations.map((operation) => (
                <tr key={operation.id} className="border-line-soft border-b">
                  <td className="py-2 font-mono uppercase">{operation.underlying}</td>
                  <td className="py-2 font-mono tabular-nums">
                    {formatDate(sessionDateToDisplayDate(operation.openedAt))}
                  </td>
                  <td className="py-2 font-mono tabular-nums">
                    {formatDate(sessionDateToDisplayDate(operation.closedAt))}
                  </td>
                  <td
                    className={`py-2 text-right font-mono tabular-nums ${operation.pnl < 0 ? "text-down" : "text-up"}`}
                  >
                    {formatBRL(operation.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={t.report.missedEntries.title}>
        {run.missedEntries.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.report.missedEntries.empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
                <th className="py-2 font-normal">{t.report.missedEntries.columns.ticker}</th>
                <th className="py-2 font-normal">{t.report.missedEntries.columns.signalAt}</th>
                <th className="py-2 font-normal">{t.report.missedEntries.columns.reason}</th>
              </tr>
            </thead>
            <tbody>
              {run.missedEntries.map((entry, index) => (
                <tr key={`${entry.ticker}-${String(index)}`} className="border-line-soft border-b">
                  <td className="py-2 font-mono uppercase">{entry.ticker}</td>
                  <td className="py-2 font-mono tabular-nums">
                    {formatDateTime(new Date(entry.signalAt))}
                  </td>
                  <td className="py-2">{missedEntryReasonLabel[entry.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={t.report.limitBreaches.title}>
        {run.limitBreaches.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.report.limitBreaches.empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
                <th className="py-2 font-normal">{t.report.limitBreaches.columns.session}</th>
                <th className="py-2 font-normal">{t.report.limitBreaches.columns.ticker}</th>
                <th className="py-2 font-normal">{t.report.limitBreaches.columns.limit}</th>
              </tr>
            </thead>
            <tbody>
              {run.limitBreaches.map((breach, index) => (
                <tr
                  key={`${breach.session}-${String(index)}`}
                  className="border-line-soft border-b"
                >
                  <td className="py-2 font-mono tabular-nums">
                    {formatDate(sessionDateToDisplayDate(breach.session))}
                  </td>
                  <td className="py-2 font-mono uppercase">{breach.ticker}</td>
                  <td className="py-2">{riskLimitLabel[breach.limit]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {generalNotes.length > 0 ? (
        <Panel title={t.report.notes}>
          <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
            {generalNotes.map((note, index) => (
              <li key={`${note.code}-${String(index)}`}>{noteMessage(note.code)}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
