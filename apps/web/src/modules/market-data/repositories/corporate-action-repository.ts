import { asc, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { corporateActionFactors } from "../schema";

export interface CorporateActionFactorRow {
  ticker: string;
  exDate: string;
  asOf: Date;
  factor: string;
}

export async function corporateActionsForTicker(
  db: Database,
  ticker: string,
): Promise<CorporateActionFactorRow[]> {
  return db
    .select()
    .from(corporateActionFactors)
    .where(eq(corporateActionFactors.ticker, ticker))
    .orderBy(asc(corporateActionFactors.exDate));
}
