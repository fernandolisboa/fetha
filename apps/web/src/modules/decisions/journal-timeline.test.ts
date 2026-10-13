import { describe, expect, it } from "vitest";

import type { JournalAnalysis } from "./analyses-repository";
import type { DecisionListItem } from "./decisions-repository";
import { buildJournalTimeline } from "./journal-timeline";

function decision(
  id: string,
  decidedAt: string,
  origin: Partial<DecisionListItem> = {},
): DecisionListItem {
  return {
    id,
    kind: "enter",
    originKind: "contemplated_operation",
    signalId: null,
    contemplatedOperationId: "op-1",
    operationId: null,
    decidedAt: new Date(decidedAt),
    ...origin,
  } as DecisionListItem;
}

function analysis(
  id: string,
  requestedAt: string,
  subjectKind: JournalAnalysis["subjectKind"] = "contemplated_operation",
  subjectId = "op-1",
): JournalAnalysis {
  return { id, requestedAt: new Date(requestedAt), subjectKind, subjectId } as JournalAnalysis;
}

function shape(entries: ReturnType<typeof buildJournalTimeline>) {
  return entries.map((entry) =>
    entry.kind === "decision"
      ? { decision: entry.decision.id, analyses: entry.analyses.map((a) => a.id) }
      : { analysis: entry.analysis.id },
  );
}

describe("buildJournalTimeline", () => {
  it("puts an analysis under the first later decision on the same subject", () => {
    const entries = buildJournalTimeline(
      [decision("d2", "2026-10-12T15:00:00Z"), decision("d1", "2026-10-10T15:00:00Z")],
      [analysis("a1", "2026-10-09T15:00:00Z"), analysis("a2", "2026-10-11T15:00:00Z")],
    );
    expect(shape(entries)).toEqual([
      { decision: "d2", analyses: ["a2"] },
      { decision: "d1", analyses: ["a1"] },
    ]);
  });

  it("keeps an analysis on its own when no decision followed it or the subject differs", () => {
    const entries = buildJournalTimeline(
      [decision("d1", "2026-10-10T15:00:00Z")],
      [
        analysis("after", "2026-10-11T15:00:00Z"),
        analysis("other", "2026-10-09T15:00:00Z", "contemplated_operation", "op-2"),
        analysis("backtest", "2026-10-08T15:00:00Z", "backtest_run", "run-1"),
      ],
    );
    expect(shape(entries)).toEqual([
      { analysis: "after" },
      { decision: "d1", analyses: [] },
      { analysis: "other" },
      { analysis: "backtest" },
    ]);
  });

  it("matches each origin kind to its own subject id", () => {
    const entries = buildJournalTimeline(
      [
        decision("signal", "2026-10-10T15:00:00Z", {
          originKind: "signal",
          signalId: "s-1",
          contemplatedOperationId: null,
        }),
        decision("held", "2026-10-10T16:00:00Z", {
          originKind: "held_operation",
          operationId: "h-1",
          contemplatedOperationId: null,
        }),
      ],
      [
        analysis("a-signal", "2026-10-10T14:00:00Z", "signal", "s-1"),
        analysis("a-held", "2026-10-10T14:00:00Z", "held_operation", "h-1"),
        analysis("a-wrong-kind", "2026-10-10T14:00:00Z", "held_operation", "s-1"),
      ],
    );
    expect(shape(entries)).toEqual([
      { decision: "held", analyses: ["a-held"] },
      { decision: "signal", analyses: ["a-signal"] },
      { analysis: "a-wrong-kind" },
    ]);
  });
});
