import type { EvaluationLogItem } from "./signals-repository";

// The log rows that carry a re-evaluate control (docs/adr/0047): one per
// (strategy, session), on its first row, since a re-evaluation covers every
// ticker of that session at once. A clamp row marks sessions never
// evaluated, and an archived strategy cannot be re-evaluated, so neither
// carries one.
export function reevaluationAnchors(rows: readonly EvaluationLogItem[]): Set<string> {
  const seen = new Set<string>();
  const anchors = new Set<string>();
  for (const row of rows) {
    if (row.reason === "catchup_clamped" || row.strategyArchived) continue;
    const key = `${row.strategyId}|${row.session}`;
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.add(row.id);
  }
  return anchors;
}
