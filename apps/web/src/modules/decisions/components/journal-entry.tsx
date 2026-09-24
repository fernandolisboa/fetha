import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format/date-time";
import { formatPercent } from "@/lib/format/percent";

import type { DecisionListItem } from "../decisions-repository";
import { t } from "../strings";

// A session-date string ("2026-10-17") formatted DESIGN.md's way
// ("17/10/2026") without going through `formatDate`'s `Date`/timezone path:
// a plain calendar date has no time-of-day to misinterpret across zones.
function formatSessionDate(session: string): string {
  const [year, month, day] = session.split("-");
  return `${day ?? ""}/${month ?? ""}/${year ?? ""}`;
}

function claimSentence(decision: DecisionListItem): string {
  if (decision.claim === null) {
    return t.journal.claimNone;
  }
  if (decision.claim.kind === "close_above") {
    return t.journal.claimCloseAbove(decision.claim.instrument, decision.claim.level);
  }
  if (decision.claim.kind === "close_below") {
    return t.journal.claimCloseBelow(decision.claim.instrument, decision.claim.level);
  }
  return t.journal.claimOperationPnlPositive;
}

function origin(decision: DecisionListItem): string {
  if (decision.inputs.originKind === "signal") {
    return t.journal.originSignal(decision.inputs.strategyName, decision.inputs.ticker);
  }
  return t.journal.originOperation(decision.inputs.structureName, decision.inputs.underlying);
}

// DESIGN.md's JournalEntry: decision kind, origin, decided date/time,
// rationale, thesis claim in words, confidence as `%`, horizon date and the
// score slot rendered "pendente" (scoring is #29).
export function JournalEntry({ decision }: { decision: DecisionListItem }) {
  return (
    <li className="border-line-soft flex flex-col gap-2 border-b py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{t.kind[decision.kind]}</Badge>
          <span className="text-sm">{origin(decision)}</span>
        </div>
        <span className="font-mono text-[12px] tabular-nums">
          {formatDateTime(decision.decidedAt)}
        </span>
      </div>

      <p className="text-sm">{decision.rationale}</p>

      <p className="text-muted-foreground text-sm">{claimSentence(decision)}</p>

      <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
        <span>
          {t.journal.confidenceLabel}:{" "}
          <span className="font-mono tabular-nums">{formatPercent(decision.confidence)}</span>
        </span>
        <span>
          {t.journal.horizonLabel}:{" "}
          <span className="font-mono tabular-nums">{formatSessionDate(decision.horizon)}</span>
        </span>
        <span>{t.journal.score.pending}</span>
      </div>
    </li>
  );
}
