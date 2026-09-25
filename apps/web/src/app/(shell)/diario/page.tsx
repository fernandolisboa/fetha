import type { Metadata } from "next";

import { requireUser } from "@/modules/auth";
import {
  getMyDecisionScores,
  getMyDecisions,
  getMyTrackRecordStats,
  JournalEntry,
  TrackRecordPanel,
  t,
} from "@/modules/decisions";
import { EmptyState, Panel, t as shellStrings } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.journal}` };

export default async function JournalPage() {
  await requireUser();
  const decisions = await getMyDecisions();

  if (decisions.length === 0) {
    return <EmptyState sentence={shellStrings.emptyStates.journal.sentence} />;
  }

  const [scores, trackRecordStats] = await Promise.all([
    getMyDecisionScores(decisions.map((decision) => decision.id)),
    getMyTrackRecordStats(),
  ]);

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      <div>
        <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {t.journal.overline}
        </p>
        <h1 className="text-[22px] font-semibold tracking-tight">{t.journal.title}</h1>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-[14px]">
        <Panel>
          <ul>
            {decisions.map((decision) => (
              <JournalEntry key={decision.id} decision={decision} score={scores.get(decision.id)} />
            ))}
          </ul>
        </Panel>

        <TrackRecordPanel stats={trackRecordStats} />
      </div>
    </div>
  );
}
