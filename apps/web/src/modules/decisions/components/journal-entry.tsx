import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/format/brl";
import { formatDateTime } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";

import type { DecisionScoreRow } from "../decision-scores-repository";
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

// The score row's own words (brief item 4): normalized P&L, raw P&L, the
// thesis claim's outcome in one of three states, Brier and — only for a
// `do_not_enter` decision, the one kind a counterfactual makes sense for —
// what the P&L would have been had the user entered anyway.
function ScoreDetails({ decision, score }: { decision: DecisionListItem; score: DecisionScoreRow }) {
  const thesisSentence =
    score.claimHeld === null
      ? t.journal.score.thesisNone
      : score.claimHeld
        ? t.journal.score.thesisHeld
        : t.journal.score.thesisNotHeld;

  return (
    <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
      {score.normalizedPnl !== null ? (
        <span>
          {t.journal.score.normalizedPnlLabel}:{" "}
          <span className="font-mono tabular-nums">{formatPercent(score.normalizedPnl)}</span>
        </span>
      ) : null}
      {score.pnlCentavos !== null ? (
        <span>
          {t.journal.score.pnlLabel}:{" "}
          <span className="font-mono tabular-nums">{formatBRL(score.pnlCentavos)}</span>
        </span>
      ) : null}
      <span>{thesisSentence}</span>
      {score.brier !== null ? (
        <span>
          {t.journal.score.brierLabel}:{" "}
          <span className="font-mono tabular-nums">{formatDecimal(score.brier, 4)}</span>
        </span>
      ) : null}
      {decision.kind === "do_not_enter" && score.counterfactualPnlCentavos !== null ? (
        <span>
          {t.journal.score.counterfactualLabel}:{" "}
          <span className="font-mono tabular-nums">
            {formatBRL(score.counterfactualPnlCentavos)}
          </span>
        </span>
      ) : null}
    </div>
  );
}

// DESIGN.md's JournalEntry: decision kind, origin, decided date/time,
// rationale, thesis claim in words, confidence as `%`, horizon date and the
// score slot — its components (brief item 4) once scored, "pendente"
// otherwise.
export function JournalEntry({
  decision,
  score,
}: {
  decision: DecisionListItem;
  score?: DecisionScoreRow;
}) {
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
        {!score ? <span>{t.journal.score.pending}</span> : null}
      </div>

      {score ? <ScoreDetails decision={decision} score={score} /> : null}
    </li>
  );
}
