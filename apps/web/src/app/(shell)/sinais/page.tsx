import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import { EmptyState, Panel, t as shellStrings } from "@/modules/shell";
import { formatDateTime } from "@/lib/format/date-time";
import { getMyEvaluationLog, getMySignals, SignalRow, t } from "@/modules/strategies";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.signals}` };

export default async function SignalsPage() {
  await requireUser();
  const [signals, evaluationLog] = await Promise.all([getMySignals(), getMyEvaluationLog()]);

  if (signals.length === 0 && evaluationLog.length === 0) {
    return <EmptyState sentence={shellStrings.emptyStates.signals.sentence} />;
  }

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      <div>
        <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {t.inbox.overline}
        </p>
        <h1 className="text-[22px] font-semibold tracking-tight">{t.inbox.title}</h1>
      </div>

      <Panel>
        {signals.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {shellStrings.emptyStates.signals.sentence}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
                <th className="py-2 font-normal">{t.inbox.columns.strategy}</th>
                <th className="py-2 font-normal">{t.inbox.columns.instrument}</th>
                <th className="py-2 font-normal" />
                <th className="py-2 font-normal">{t.inbox.columns.evaluatedAt}</th>
                <th className="py-2 font-normal">{t.inbox.columns.proposal}</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {signals.map((signal) => (
                <SignalRow key={signal.id} signal={signal} />
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={t.inbox.evaluationLog.title}>
        {evaluationLog.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.inbox.evaluationLog.empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
                <th className="py-2 font-normal">{t.inbox.columns.strategy}</th>
                <th className="py-2 font-normal">{t.inbox.columns.instrument}</th>
                <th className="py-2 font-normal">{t.inbox.columns.evaluatedAt}</th>
                <th className="py-2 font-normal">{t.inbox.outcomes.signal}</th>
              </tr>
            </thead>
            <tbody>
              {evaluationLog.map((row) => {
                const detail = row.detail ? t.inbox.evaluationLog.detailFor(row.detail) : undefined;
                return (
                  <tr key={row.id} className="border-line-soft border-b">
                    <td className="py-2">{row.strategyName}</td>
                    <td className="py-2 font-mono uppercase tabular-nums">{row.ticker}</td>
                    <td className="py-2 font-mono tabular-nums">{formatDateTime(row.at)}</td>
                    <td className="text-muted-foreground py-2">
                      {t.inbox.outcomes[row.outcome]}
                      {detail ? ` · ${detail}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
