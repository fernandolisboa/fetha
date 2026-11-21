import Link from "next/link";

import { formatDate } from "@/lib/format/date-time";
import { Panel } from "@/modules/shell";

import type { PlanSignalListEntry } from "../plan-signals-queries";
import { t } from "../strings";

// Read-only alerts for an executed plan (ADR-0079 addendum, ticket #381): target hit, stop hit
// or roll due. No order is ever sent from here; the user acts on it from the Carteira itself.
export function PlanSignalsPanel({ signals }: { signals: PlanSignalListEntry[] }) {
  if (signals.length === 0) return null;
  return (
    <Panel title={t.signals.panelTitle}>
      <ul className="flex flex-col gap-2">
        {signals.map((signal) => (
          <li key={signal.id} className="flex items-center justify-between gap-3 py-1 text-[13px]">
            <span className="flex items-center gap-2">
              <span
                className="font-mono text-[11px] uppercase"
                style={{
                  color: signal.kind === "stop_hit" ? "var(--danger)" : "var(--accent)",
                }}
              >
                {t.signals.kinds[signal.kind]}
              </span>
              <span className="font-mono uppercase">{signal.underlying}</span>
            </span>
            <span className="text-muted-foreground flex items-center gap-2 font-mono tabular-nums">
              {formatDate(signal.createdAt)}
              <Link href={`/carteira/operacoes/${signal.operationId}`} className="underline">
                {t.signals.viewPortfolio}
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
