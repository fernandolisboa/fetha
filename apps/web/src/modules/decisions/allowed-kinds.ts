import type { DecisionKind, SignalKind } from "@fetha/engine";

// Named apart from the engine's own `DecisionOrigin` (packages/engine/src/api.ts,
// `{kind:"signal"; strategy} | {kind:"manual"}`, a #29 scoring concern): this
// is the ticket #27 storage-level vocabulary the `decisions` table's
// `origin_kind` column and check constraint are generated from, the single
// source of truth both `schema.ts` and `decisions-repository.ts` read.
export const journalOriginKinds = ["signal", "contemplated_operation", "held_operation"] as const;
export type JournalOriginKind = (typeof journalOriginKinds)[number];

export type DecisionOriginInput =
  | { kind: "signal"; signalKind: SignalKind }
  | { kind: "contemplated_operation" }
  | { kind: "held_operation" };

const ENTRY_KINDS: readonly DecisionKind[] = ["enter", "do_not_enter"];
const EXIT_KINDS: readonly DecisionKind[] = ["exit", "hold"];
const ADJUST_KINDS: readonly DecisionKind[] = ["adjust", "hold"];
const HELD_KINDS: readonly DecisionKind[] = ["hold", "adjust", "exit"];

export function allowedDecisionKinds(origin: DecisionOriginInput): readonly DecisionKind[] {
  if (origin.kind === "contemplated_operation") {
    return ENTRY_KINDS;
  }
  if (origin.kind === "held_operation") {
    return HELD_KINDS;
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
