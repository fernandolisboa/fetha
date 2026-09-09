import type { CotahistOptionRow } from "./schema";
import type { CorporateActionFactorInput } from "../../repositories/corporate-action-repository";

// COTAHIST's FATCOT is a quotation-lot factor, not a split/dividend
// adjustment (ADR-0017). This detects the one thing COTAHIST alone lets us
// observe: FATCOT changing between two consecutive sessions for the same
// ticker, which re-bases the quoted price scale (e.g. after a bonus issue
// that changes the quoted lot). It does not cover dividends, which never
// show up as a FATCOT change and require a source this ticket does not add.
export function detectFatcotFactorChanges(
  previous: ReadonlyMap<string, string>,
  currentSession: string,
  asOf: Date,
  currentRows: CotahistOptionRow[],
): CorporateActionFactorInput[] {
  const changes: CorporateActionFactorInput[] = [];
  const seen = new Set<string>();

  for (const row of currentRows) {
    if (seen.has(row.ticker)) {
      continue;
    }
    seen.add(row.ticker);
    const previousFactor = previous.get(row.ticker);
    if (previousFactor !== undefined && previousFactor !== row.factor) {
      changes.push({
        ticker: row.ticker,
        exDate: currentSession,
        asOf,
        factor: row.factor,
      });
    }
  }

  return changes;
}
