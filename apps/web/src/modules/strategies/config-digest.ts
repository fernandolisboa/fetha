import { createHash } from "node:crypto";
import type { StrategyDefinition } from "@fetha/contracts";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

// A definition is content-addressed so two saves with the same definition
// (e.g. a copy of a shared strategy) can be compared without a deep-equal
// over the JSON tree at read time.
export function computeConfigDigest(definition: StrategyDefinition): string {
  const canonical = JSON.stringify(sortKeysDeep(definition));
  return createHash("sha256").update(canonical).digest("hex");
}
