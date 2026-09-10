import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/format/brl";
import { formatDateTime } from "@/lib/format/date-time";

import { MarkSignalReadButton } from "./mark-signal-read-button";
import { t } from "../strings";
import type { SignalListItem } from "../signals-repository";

function proposalSummary(signal: SignalListItem): string {
  if (signal.kind === "exit") {
    return t.inbox.exitProposal;
  }
  if (signal.kind === "adjust" && !signal.proposal) {
    return t.inbox.adjustProposal;
  }
  if (signal.proposal) {
    return t.inbox.entryProposal(
      signal.proposal.legs.length,
      formatBRL(signal.proposal.pricing.netPremium),
    );
  }
  return "";
}

// DESIGN.md's domain component inventory: strategy, instrument, evaluation
// time, late flag, proposal summary. `late` is always false until intraday
// catch-up evaluation ships (#19 only evaluates daily strategies; the chip
// itself is ADR-0010's, kept here so the intraday ticket only has to pass
// `true`).
export function SignalRow({ signal, late = false }: { signal: SignalListItem; late?: boolean }) {
  return (
    <tr className="border-line-soft border-b" data-signal-id={signal.id}>
      <td className="py-2">{signal.strategyName}</td>
      <td className="py-2 font-mono uppercase tabular-nums">{signal.ticker}</td>
      <td className="py-2">
        <Badge variant="secondary">{t.inbox.kind[signal.kind]}</Badge>
      </td>
      <td className="py-2 font-mono tabular-nums">
        {formatDateTime(signal.at)}
        {late && (
          <Badge variant="outline" className="ml-2 border-[var(--warning)] text-[var(--warning)]">
            {t.inbox.late}
          </Badge>
        )}
      </td>
      <td className="text-muted-foreground py-2">{proposalSummary(signal)}</td>
      <td className="py-2 text-right">
        <MarkSignalReadButton signalId={signal.id} read={signal.readAt !== null} />
      </td>
    </tr>
  );
}
