import type { Condition } from "@fetha/contracts";

export type CompareCondition = Extract<Condition, { kind: "compare" }>;

// The editor's closed vocabulary (docs/adr/0008) offers one compare row per
// condition, ANDed together: it covers every strategy the catalog needs
// today without a recursive and/or/not tree builder in the UI. This
// fallback is used only by `toEditableEntry` below, which keeps the
// original tree instead of discarding it when the shape does not match.
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

export type EditableEntry =
  { editable: true; conditions: CompareCondition[] } | { editable: false; original: Condition };

// A condition entry that is not a compare or a flat AND-of-compares (an
// `or`, a `not`, a nested `and`) still round-trips through the contracts
// schema, but this editor cannot render it as rows. `toEditableEntry` /
// `fromEditableEntry` keep that subtree byte-for-byte instead of silently
// replacing it with `fallback` and writing the replacement back on save
// (the bug this type exists to make impossible: see the editor's read-only
// notice for the `editable: false` case).
export function toEditableEntry(entry: Condition): EditableEntry {
  if (entry.kind === "compare") {
    return { editable: true, conditions: [entry] };
  }
  if (entry.kind === "and" && entry.conditions.every((condition) => condition.kind === "compare")) {
    return { editable: true, conditions: entry.conditions };
  }
  return { editable: false, original: entry };
}

export function fromEditableEntry(entry: EditableEntry): Condition {
  return entry.editable ? compareConditionsToEntry(entry.conditions) : entry.original;
}

export type EditableExitCondition =
  { editable: true; condition: CompareCondition } | { editable: false; original: Condition };

// A `condition` exit rule renders a single compare row, never a list: a flat
// AND of two or more compares (or an `or`/`not`/nested `and`) still
// round-trips through the schema but is not editable here, so it is kept
// byte-for-byte as a read-only original instead of being truncated to its
// first compare and silently rewritten on save (docs/adr/0008).
export function toEditableExitCondition(condition: Condition): EditableExitCondition {
  return condition.kind === "compare"
    ? { editable: true, condition }
    : { editable: false, original: condition };
}

export function fromEditableExitCondition(entry: EditableExitCondition): Condition {
  return entry.editable ? entry.condition : entry.original;
}
