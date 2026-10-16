import { factAt, outlookOf, verdictOf, type AnalysisInputs } from "@fetha/contracts";

import { Badge } from "@/components/ui/badge";
import { formatPriceBRL } from "@/lib/format/brl";
import { formatDateTime } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";

import type { JournalAnalysis } from "../analyses-repository";
import type { AnalysisScoreRow } from "../analysis-scores-repository";
import { t } from "../strings";

import { modelDisplayName } from "@/modules/ai-models/client";
import { formatSessionDate, unscorableReasonLabel } from "./journal-entry";

const labels = t.journal.analysis;

function fact(inputs: AnalysisInputs, path: string): string {
  const value = factAt(inputs.facts, path);
  return typeof value === "string" ? value : "";
}

// The subject in the journal's own words, read from the facts the analysis
// was given (they are already display strings, docs/adr/0057).
export function analysisOrigin(analysis: Pick<JournalAnalysis, "inputs">): string {
  const { inputs } = analysis;
  switch (inputs.subject) {
    case "signal":
      return labels.originSignal(fact(inputs, "ticker"));
    case "contemplated_operation":
      return t.journal.originOperation(fact(inputs, "structure"), fact(inputs, "underlying"));
    case "held_operation":
      return t.journal.originHeldOperation(fact(inputs, "underlying"));
    case "backtest_run":
      return labels.originBacktest(fact(inputs, "period.from"), fact(inputs, "period.to"));
    case "suggestion":
      return labels.originSuggestion(fact(inputs, "structure"), fact(inputs, "underlying"));
  }
}

// docs/adr/0058: the resolved claim when there is one, so the sentence shows
// the horizon date the engine scores against. An `analysis@1` reply was never
// asked for an outlook, so it gets no line at all.
export function outlookSentence(
  analysis: Pick<JournalAnalysis, "output" | "claim">,
): string | null {
  if (!("outlook" in analysis.output)) {
    return null;
  }
  const outlook = outlookOf(analysis.output);
  if (outlook === null) {
    return labels.outlookNone;
  }
  if (!analysis.claim) {
    return labels.outlookUndated;
  }
  const { claim } = analysis.claim;
  return t.analysis.outlook(
    claim.instrument,
    claim.kind === "close_above" ? "above" : "below",
    formatPriceBRL(claim.level),
    `${t.analysis.horizon[outlook.horizon]} (${formatSessionDate(analysis.claim.horizon)})`,
  );
}

function ScoreLine({ analysis, score }: { analysis: JournalAnalysis; score?: AnalysisScoreRow }) {
  if (!analysis.claim) {
    return null;
  }
  if (!score) {
    return <span>{t.journal.score.pending}</span>;
  }
  if (score.unscorableReason !== null) {
    return (
      <span>
        {t.journal.score.unscorable} — {unscorableReasonLabel(score.unscorableReason)}
      </span>
    );
  }
  return (
    <>
      <span>{score.claimHeld ? labels.outlookHeld : labels.outlookNotHeld}</span>
      {score.brier !== null ? (
        <span>
          {t.journal.score.brierLabel}:{" "}
          <span className="font-mono tabular-nums">{formatDecimal(score.brier, 4)}</span>
        </span>
      ) : null}
    </>
  );
}

// An accepted AI analysis in the journal (docs/adr/0058): its subject, when
// it was asked, the thesis in the model's words, the outlook it committed to
// and the engine's score of that outlook once its horizon has passed.
export function AnalysisJournalItem({
  analysis,
  score,
}: {
  analysis: JournalAnalysis;
  score?: AnalysisScoreRow;
}) {
  const outlook = outlookOf(analysis.output);
  const verdict = verdictOf(analysis.output);
  const sentence = outlookSentence(analysis);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{labels.badge}</Badge>
          <span className="text-sm">{analysisOrigin(analysis)}</span>
        </div>
        <span className="font-mono text-[12px] tabular-nums">
          {formatDateTime(analysis.requestedAt)}
        </span>
      </div>

      {verdict !== null ? (
        <p className="text-sm">
          {labels.verdictLabel}:{" "}
          <span className="font-medium">{t.analysis.verdict[verdict.decision]}</span>
        </p>
      ) : null}

      <p className="text-sm text-pretty whitespace-pre-wrap">{analysis.output.thesis}</p>

      {sentence !== null ? (
        <p className="text-muted-foreground text-sm">
          {labels.outlookLabel}: {sentence}
        </p>
      ) : null}

      <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
        {outlook !== null ? (
          <span>
            {labels.likelihoodLabel}: {t.analysis.likelihood[outlook.likelihood]}
          </span>
        ) : null}
        <ScoreLine analysis={analysis} score={score} />
        <span>
          {analysis.promptVersion} · {modelDisplayName(analysis.model)}
        </span>
      </div>
    </div>
  );
}
