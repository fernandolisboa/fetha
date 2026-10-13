import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import {
  AnalysisJournalItem,
  buildJournalTimeline,
  getMyAnalysisScores,
  getMyAnalysisTrackRecordStats,
  getMyDecisionScores,
  getMyDecisions,
  getMyJournalAnalyses,
  getMyTrackRecordStats,
  JournalEntry,
  TrackRecordPanel,
  t,
} from "@/modules/decisions";
import { EmptyState, PageHeader, Panel, t as shellStrings } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.journal}` };

export default async function JournalPage() {
  await requireUser();
  const [decisions, analyses] = await Promise.all([getMyDecisions(), getMyJournalAnalyses()]);

  if (decisions.length === 0 && analyses.length === 0) {
    return <EmptyState sentence={shellStrings.emptyStates.journal.sentence} />;
  }

  const [scores, trackRecordStats, analysisScores, analysisTrackRecordStats] = await Promise.all([
    getMyDecisionScores(decisions.map((decision) => decision.id)),
    getMyTrackRecordStats(),
    getMyAnalysisScores(analyses.map((analysis) => analysis.id)),
    getMyAnalysisTrackRecordStats(),
  ]);

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      <PageHeader overline={t.journal.overline} headline={t.journal.title} />

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-[14px]">
        <Panel>
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
                <li
                  key={entry.analysis.id}
                  className="border-line-soft border-b py-4 last:border-b-0"
                >
                  <AnalysisJournalItem
                    analysis={entry.analysis}
                    score={analysisScores.get(entry.analysis.id)}
                  />
                </li>
              ),
            )}
          </ul>
        </Panel>

        <TrackRecordPanel stats={trackRecordStats} analysisStats={analysisTrackRecordStats} />
      </div>
    </div>
  );
}
