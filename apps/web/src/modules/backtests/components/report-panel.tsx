import type { ReactNode } from "react";
import { Decimal } from "decimal.js";
import type { Centavos, RiskProfile } from "@fetha/contracts";
import type {
  BacktestRun,
  EquityPoint,
  LimitMode,
  MissedEntryReason,
  NoteCode,
  RiskLimit,
} from "@fetha/engine";

import { formatBRL } from "@/lib/format/brl";
import { formatDate, formatDateTime } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
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

// The run's own declared limits, formatted for display beside the limit
// breaches panel: an empty breaches table alone reads as "no limits were
// ever checked", not as "these specific limits were checked and never
// breached" (round 1 item 30).
export function declaredLimitValues(limits: RiskProfile["limits"]): Record<RiskLimit, string> {
  return {
    maxLossPerOperation: formatPercent(limits.maxLossPerOperation),
    maxExposurePerOperation: formatPercent(limits.maxExposurePerOperation),
    maxOpenOperations: String(limits.maxOpenOperations),
    maxPremiumBought: formatPercent(limits.maxPremiumBought),
  };
}

export function limitModeLabel(mode: LimitMode): string {
  return mode === "enforce" ? t.report.limitBreaches.modeEnforce : t.report.limitBreaches.modeWarn;
}

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

function DeclaredLimits({ riskProfile, mode }: { riskProfile: RiskProfile; mode: LimitMode }) {
  const values = declaredLimitValues(riskProfile.limits);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="text-muted-foreground tracking-[0.06em] uppercase">
        {t.report.limitBreaches.declaredLimits} · {limitModeLabel(mode)}
      </span>
      {(Object.keys(riskLimitLabel) as RiskLimit[]).map((limit) => (
        <span key={limit} className="font-mono tabular-nums">
          {riskLimitLabel[limit]}: {values[limit]}
        </span>
      ))}
    </div>
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

const equityDrawdownCodes: NoteCode[] = ["negative_cash"];
const annualizedCodes: NoteCode[] = ["short_window_not_annualized", "non_positive_equity"];
const limitBreachCodes: NoteCode[] = ["limit_breach_warned"];
// `run-backtest.ts` (packages/engine) assembles `BacktestRun.notes` from the
// metrics notes plus exactly four run-level codes: `negative_cash`,
// `limit_breach_warned`, `non_positive_equity` and
// `option_strike_unadjusted_across_corporate_action`. `no_operation`,
// `less_than_one_effective_unit` and `no_risk_profile` are valid `NoteCode`
// union members but the run never emits them here — the first two are
// per-operation/per-fill notes `priceOperation` and settlement produce and
// the engine does not roll up onto the run. `no_risk_profile` *is*
// engine-emitted, in three files (price-operation.ts, stock-pricing.ts,
// mark-to-market.ts, packages/engine/src/internal/notes.ts's
// NO_RISK_PROFILE_NOTE); what keeps it out of a backtest report is that
// backtests/actions.ts refuses to create a run without a declared risk
// profile, and that profile rides on the run into every pricing call
// (round 3 item 3, round 4 item 5, correcting round 2 item 15's mistaken
// instruction to filter it as if it were never emitted). Only the one code
// the run does emit is filtered here, to keep it out of the general notes
// panel: it renders once at this panel's own head via `<NotesFor
// codes={operationCodes} />` below, not per operations-table row (round 2
// item 6). If the report should ever show the per-operation notes, the
// engine needs to roll them up onto the run first (see the follow-up issue
// filed for this).
const operationCodes: NoteCode[] = ["option_strike_unadjusted_across_corporate_action"];
const surfacedCodes: NoteCode[] = [
  ...equityDrawdownCodes,
  ...annualizedCodes,
  ...limitBreachCodes,
  ...operationCodes,
];

// Every note code this panel surfaces beside a specific chart, stat or
// table: anything a run carries outside this set falls through to the
// generic notes panel instead (`generalNotesFor`, below). Exported so the
// operations-table attachment (round 2 item 6) has something other than a
// rendered DOM to assert against.
export const surfacedNoteCodes: NoteCode[] = surfacedCodes;

export function generalNotesFor(run: BacktestRun): BacktestRun["notes"] {
  return run.notes.filter((note) => !surfacedCodes.includes(note.code));
}

// Per-session equity returns, not operation P&L over starting capital:
// an operation's P&L divided by the run's *starting* capital ignores
// compounding and folds in period_end marks the engine already excludes
// from winRate/profitFactor, both of which distort the histogram. The
// first session's own return (from `initialCapital` into the first equity
// point) is included, not dropped: it is as real a session as any other
// (round 2 item 13). A base that is zero *or negative* is skipped rather
// than only a base of exactly zero: a run that went insolvent and then
// recovered (equity −R$10,00 → −R$5,00) is a 50% improvement, not the 50%
// loss the unsigned ratio of two negatives would otherwise report.
export function sessionReturns(initialCapital: Centavos, equityCurve: EquityPoint[]): number[] {
  const returns: number[] = [];
  let previousEquity: number = initialCapital;
  for (const point of equityCurve) {
    if (previousEquity <= 0) {
      previousEquity = point.equity;
      continue;
    }
    returns.push(new Decimal(point.equity).minus(previousEquity).div(previousEquity).toNumber());
    previousEquity = point.equity;
  }
  return returns;
}

export function ReportPanel({ run }: { run: BacktestRun }) {
  const { metrics } = run;
  const returns = sessionReturns(run.config.initialCapital, run.equityCurve);
  const generalNotes = generalNotesFor(run);

  return (
    <div className="flex flex-col gap-6">
      <Panel title={t.report.equityCurve}>
        <EquityCurveChart points={run.equityCurve} />
        <NotesFor run={run} codes={equityDrawdownCodes} />
      </Panel>

      <Panel title={t.report.drawdown}>
        <DrawdownChart points={run.equityCurve} />
      </Panel>

      <Panel title={t.report.distribution} subtitle={t.report.distributionBasis}>
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
            value={metrics.sharpe ? formatDecimal(metrics.sharpe) : "—"}
            notes={<NotesFor run={run} codes={annualizedCodes} />}
          />
          <Stat
            label={t.report.metrics.winRate}
            value={metrics.winRate ? formatPercent(metrics.winRate) : "—"}
          />
          <Stat
            label={t.report.metrics.profitFactor}
            value={metrics.profitFactor ? formatDecimal(metrics.profitFactor) : "—"}
          />
          <Stat label={t.report.metrics.exposure} value={formatPercent(metrics.exposure)} />
          <Stat label={t.report.metrics.fees} value={formatBRL(metrics.fees)} />
          <Stat label={t.report.metrics.taxes} value={formatBRL(metrics.taxes)} />
          <Stat label={t.report.metrics.slippage} value={formatBRL(metrics.slippage)} />
        </div>
      </Panel>

      <Panel title={t.report.operationsTable.title}>
        <NotesFor run={run} codes={operationCodes} />
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

      {/* Walk-forward windows are the immutable run's own creation-time
          concern (issue #30 — a run cannot gain walk-forward retroactively)
          and are out of this panel's scope; only the declared limits, which
          every existing run already carries, render here. */}
      <Panel title={t.report.limitBreaches.title}>
        <DeclaredLimits riskProfile={run.config.riskProfile} mode={run.config.limits} />
        <NotesFor run={run} codes={limitBreachCodes} />
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
                  <td className="text-warning py-2">{riskLimitLabel[breach.limit]}</td>
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

      <Panel title={t.report.provenance.title}>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span>
            <span className="text-muted-foreground">{t.report.provenance.engineVersion}: </span>
            <span className="font-mono">{run.provenance.engineVersion}</span>
          </span>
          <span>
            <span className="text-muted-foreground">{t.report.provenance.dataVersion}: </span>
            <span className="font-mono tabular-nums">
              {run.provenance.dataVersion
                ? formatDateTime(new Date(run.provenance.dataVersion))
                : t.report.provenance.dataVersionUnknown}
            </span>
          </span>
        </div>
      </Panel>
    </div>
  );
}
