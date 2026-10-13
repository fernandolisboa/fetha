import type { Database } from "@/db/client";

import { companyFilingsFreshness } from "./company-filings-freshness";
import {
  latestFilingDeliveredOn,
  recentCompanyFilings,
  type CompanyFilingRow,
} from "./repositories/company-filing-repository";

export interface CompanyFilingsView {
  // False until the nightly job has stored any filing at all.
  loaded: boolean;
  freshness: string | null;
  // Whether the ticker maps to a company: ETFs, FIIs and BDRs never do.
  mapped: boolean;
  filings: CompanyFilingRow[];
}

// The asset page's "Eventos recentes" read model (docs/adr/0060).
export async function companyFilingsForInstrument(
  db: Database,
  ticker: string,
  now: Date = new Date(),
): Promise<CompanyFilingsView> {
  const [recent, latestDelivery] = await Promise.all([
    recentCompanyFilings(db, ticker),
    latestFilingDeliveredOn(db),
  ]);
  return {
    loaded: latestDelivery !== undefined,
    freshness: companyFilingsFreshness(latestDelivery, now),
    ...recent,
  };
}
