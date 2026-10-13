import type { AnalysisSubjectKind } from "@fetha/contracts";

import type { JournalAnalysis } from "./analyses-repository";
import type { DecisionListItem } from "./decisions-repository";

export type JournalTimelineEntry =
  | { kind: "decision"; decision: DecisionListItem; analyses: JournalAnalysis[] }
  | { kind: "analysis"; analysis: JournalAnalysis };

function decisionSubject(
  decision: DecisionListItem,
): { kind: AnalysisSubjectKind; id: string } | null {
  switch (decision.originKind) {
    case "signal":
      return decision.signalId ? { kind: "signal", id: decision.signalId } : null;
    case "contemplated_operation":
      return decision.contemplatedOperationId
        ? { kind: "contemplated_operation", id: decision.contemplatedOperationId }
        : null;
    case "held_operation":
      return decision.operationId ? { kind: "held_operation", id: decision.operationId } : null;
    case "suggestion":
      return decision.suggestionId ? { kind: "suggestion", id: decision.suggestionId } : null;
  }
}

function entryTime(entry: JournalTimelineEntry): number {
  return entry.kind === "decision"
    ? entry.decision.decidedAt.getTime()
    : entry.analysis.requestedAt.getTime();
}

// docs/adr/0058: an analysis sits under the first decision on the same
// subject recorded at or after it, the decision it informed; any other
// analysis (a backtest run's, or one no decision followed yet) is its own
// entry. Newest first, as the journal reads.
export function buildJournalTimeline(
  decisions: readonly DecisionListItem[],
  analyses: readonly JournalAnalysis[],
): JournalTimelineEntry[] {
  const decisionEntries = decisions.map((decision) => ({
    kind: "decision" as const,
    decision,
    subject: decisionSubject(decision),
    analyses: [] as JournalAnalysis[],
  }));
  const standalone: JournalTimelineEntry[] = [];

  for (const analysis of analyses) {
    const informed = decisionEntries
      .filter(
        (entry) =>
          entry.subject?.kind === analysis.subjectKind &&
          entry.subject.id === analysis.subjectId &&
          entry.decision.decidedAt.getTime() >= analysis.requestedAt.getTime(),
      )
      .sort((a, b) => a.decision.decidedAt.getTime() - b.decision.decidedAt.getTime())[0];
    if (informed) {
      informed.analyses.push(analysis);
    } else {
      standalone.push({ kind: "analysis", analysis });
    }
  }

  const entries: JournalTimelineEntry[] = [
    ...decisionEntries.map(({ decision, analyses: informed }) => ({
      kind: "decision" as const,
      decision,
      analyses: informed.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()),
    })),
    ...standalone,
  ];
  return entries.sort((a, b) => entryTime(b) - entryTime(a));
}
