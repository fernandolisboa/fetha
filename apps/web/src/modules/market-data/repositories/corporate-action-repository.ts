import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { corporateActionFactors } from "@/db/schema/market-data";

export interface CorporateActionFactorInput {
  ticker: string;
  exDate: string;
  asOf: Date;
  factor: string;
}

// ADR-0017/ADR-0004: COTAHIST's FATCOT is a quotation-lot factor (grouping,
// e.g. thousands of units per quoted price), not a corporate-action
// adjustment factor. This repository only records what the ingestion layer
// can derive today (an explicit factor computed elsewhere, e.g. from a
// registry event); it does not infer splits or dividends from FATCOT
// changes, which are not the same thing. Dividend adjustment is out of
// scope, documented as a known gap.
export async function upsertCorporateActionFactors(
  db: Database,
  rows: CorporateActionFactorInput[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  await db
    .insert(corporateActionFactors)
    .values(rows)
    .onConflictDoUpdate({
      target: [corporateActionFactors.ticker, corporateActionFactors.exDate],
      set: {
        asOf: sql`excluded.as_of`,
        factor: sql`excluded.factor`,
      },
    });

  return rows.length;
}
