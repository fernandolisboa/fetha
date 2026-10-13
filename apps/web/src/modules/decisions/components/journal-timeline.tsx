import type { JournalAnalysis } from "../analyses-repository";
import type { AnalysisScoreRow } from "../analysis-scores-repository";
import type { DecisionScoreRow } from "../decision-scores-repository";
import type { DecisionListItem } from "../decisions-repository";
import { buildJournalTimeline } from "../journal-timeline";
import { t } from "../strings";

import { AnalysisJournalItem } from "./analysis-journal-item";
import { JournalEntry } from "./journal-entry";

export function JournalTimeline({
  decisions,
  analyses,
  scores,
  analysisScores,
}: {
  decisions: readonly DecisionListItem[];
  analyses: readonly JournalAnalysis[];
  scores: ReadonlyMap<string, DecisionScoreRow>;
  analysisScores: ReadonlyMap<string, AnalysisScoreRow>;
}) {
  return (
    <ul>
      {buildJournalTimeline(decisions, analyses).map((entry) =>
        entry.kind === "decision" ? (
          <JournalEntry
            key={entry.decision.id}
            decision={entry.decision}
            score={scores.get(entry.decision.id)}
          >
            {entry.analyses.length > 0 ? (
              <ul
                aria-label={t.journal.analysis.informedLabel}
                className="border-line-soft mt-1 flex flex-col gap-3 border-l pl-4"
              >
                {entry.analyses.map((analysis) => (
                  <li key={analysis.id}>
                    <AnalysisJournalItem
                      analysis={analysis}
                      score={analysisScores.get(analysis.id)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </JournalEntry>
        ) : (
          <li key={entry.analysis.id} className="border-line-soft border-b py-4 last:border-b-0">
            <AnalysisJournalItem
              analysis={entry.analysis}
              score={analysisScores.get(entry.analysis.id)}
            />
          </li>
        ),
      )}
    </ul>
  );
}
