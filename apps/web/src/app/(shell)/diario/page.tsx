import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import {
  getMyAnalysisScores,
  getMyAnalysisTrackRecordStats,
  getMyDecisionScores,
  getMyDecisions,
  getMyJournalAnalyses,
  getMyTrackRecordStats,
  JournalTimeline,
  TrackRecordPanel,
  t,
} from "@/modules/decisions";
import { SuggestionCalibrationPanel } from "@/modules/radar";
import { EmptyState, PageHeader, Panel, t as shellStrings } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.journal}` };

export default async function JournalPage() {
  await requireUser();
  const [decisions, analyses] = await Promise.all([getMyDecisions(), getMyJournalAnalyses()]);

  if (decisions.length === 0 && analyses.length === 0) {
    return (
      <div className="flex flex-col gap-8 px-5 py-8">
        <EmptyState sentence={shellStrings.emptyStates.journal.sentence} />
        <div className="mx-auto w-full max-w-xl">
          <SuggestionCalibrationPanel />
        </div>
      </div>
    );
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
          <JournalTimeline
            decisions={decisions}
            analyses={analyses}
            scores={scores}
            analysisScores={analysisScores}
          />
        </Panel>

        <div className="flex flex-col gap-[14px]">
          <TrackRecordPanel stats={trackRecordStats} analysisStats={analysisTrackRecordStats} />
          <SuggestionCalibrationPanel />
        </div>
      </div>
    </div>
  );
}
