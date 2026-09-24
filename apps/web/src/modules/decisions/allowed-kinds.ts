import type { DecisionKind, SignalKind } from "@fetha/engine";

export type DecisionOriginKind = "signal" | "contemplated_operation";

export type DecisionOriginInput =
  { kind: "signal"; signalKind: SignalKind } | { kind: "contemplated_operation" };

const ENTRY_KINDS: readonly DecisionKind[] = ["enter", "do_not_enter"];
const EXIT_KINDS: readonly DecisionKind[] = ["exit", "hold"];
const ADJUST_KINDS: readonly DecisionKind[] = ["adjust", "hold"];

// The kinds a user may record against one origin (brief item 3): an entry
// signal or a contemplated operation only ever asks "enter" or "do not
// enter"; an exit signal asks "exit" or "hold"; an adjust signal asks
// "adjust" or "hold". Held operations (portfolio #26) are not built yet, so
// there is no "held operation" origin here.
export function allowedDecisionKinds(origin: DecisionOriginInput): readonly DecisionKind[] {
  if (origin.kind === "contemplated_operation") {
    return ENTRY_KINDS;
  }
  switch (origin.signalKind) {
    case "entry":
      return ENTRY_KINDS;
    case "exit":
      return EXIT_KINDS;
    case "adjust":
      return ADJUST_KINDS;
  }
}
