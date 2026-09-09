import type { Condition } from "@fetha/contracts";

export type CompareCondition = Extract<Condition, { kind: "compare" }>;

// The editor's closed vocabulary (docs/adr/0008) offers one compare row per
// condition, ANDed together: it covers every strategy the catalog needs
// today without a recursive and/or/not tree builder in the UI. A definition
// entry built outside this editor (future API use, a hand-authored catalog
// entry) that is not a flat AND-of-compares still round-trips through the
// contracts schema; this editor just cannot represent it visually, so it
// falls back to a single empty row rather than throwing.
export function entryToCompareConditions(
  entry: Condition,
  fallback: CompareCondition,
): CompareCondition[] {
  if (entry.kind === "compare") {
    return [entry];
  }
  if (entry.kind === "and" && entry.conditions.every((condition) => condition.kind === "compare")) {
    return entry.conditions;
  }
  return [fallback];
}

export function compareConditionsToEntry(conditions: CompareCondition[]): Condition {
  const [first, ...rest] = conditions;
  if (!first) {
    throw new Error("at least one condition is required");
  }
  if (rest.length === 0) {
    return first;
  }
  return { kind: "and", conditions: [first, ...rest] };
}
