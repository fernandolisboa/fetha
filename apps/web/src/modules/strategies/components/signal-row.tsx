import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/format/brl";
import { formatDateTime } from "@/lib/format/date-time";

import { t } from "../strings";
import type { SignalListItem } from "../signals-repository";

function proposalSummary(signal: SignalListItem): ReactNode {
  if (signal.kind === "exit") {
    return t.inbox.exitProposal;
  }
  if (signal.kind === "adjust" && !signal.proposal) {
    return t.inbox.adjustProposal;
  }
  if (signal.proposal) {
    // A stock-only proposal has no premium: `netPremium` is the gross cost
    // of the shares before costs, not a premium, so it gets its own label
    // (#19 round-1 review, item 18).
    const isStockOnly = signal.proposal.legs.every((leg) => leg.role === "stock");
    const label = isStockOnly
      ? t.inbox.entryProposalCostLabel
      : t.inbox.entryProposalNetPremiumLabel;
    return (
      <>
        <span className="font-mono tabular-nums">
          {t.inbox.entryProposalLegs(signal.proposal.legs.length)}
        </span>
        {" · "}
        {label}{" "}
        <span className="font-mono tabular-nums">
          {formatBRL(signal.proposal.pricing.netPremium)}
        </span>
      </>
    );
  }
  return "";
}

// DESIGN.md's domain component inventory: strategy, instrument, evaluation
// time, late flag, proposal summary. `late` is always false until intraday
// catch-up evaluation ships (#19 only evaluates daily strategies; the chip
// itself is ADR-0010's, kept here so the intraday ticket only has to pass
// `true`). `decisionSlot` is composed by the caller (the `/sinais` page,
// which alone may depend on both this module and `decisions`): the
// recorded-decision label or the DecisionBar trigger, per DESIGN.md's
// DecisionBar and #27's "answering a signal marks it read" rule.
export function SignalRow({
  signal,
  decisionSlot,
  late = false,
}: {
  signal: SignalListItem;
  decisionSlot: ReactNode;
  late?: boolean;
}) {
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
      <td className="py-2 text-right">{decisionSlot}</td>
    </tr>
  );
}
