import type { Database } from "@/db/client";
import { companiesOfTickers } from "@/modules/market-data";
import { watchedTickersOfAnyUser } from "@/modules/watchlist";

export interface SentimentCompany {
  cnpj: string;
  companyName: string | null;
  tickers: string[];
}

export interface SentimentUniverse {
  tickers: string[];
  companies: SentimentCompany[];
}

// docs/adr/0065: the union of every watchlist, until the radar (#308) adds
// its own universe. Tickers with no company (ETFs, FIIs, BDRs) still get
// provider articles, never filings or GDELT tone.
export async function sentimentUniverse(db: Database): Promise<SentimentUniverse> {
  const tickers = await watchedTickersOfAnyUser(db);
  const byCnpj = new Map<string, SentimentCompany>();
  for (const company of await companiesOfTickers(db, tickers)) {
    const entry = byCnpj.get(company.cnpj) ?? {
      cnpj: company.cnpj,
      companyName: company.companyName,
      tickers: [],
    };
    entry.tickers.push(company.ticker);
    byCnpj.set(company.cnpj, entry);
  }
  return { tickers, companies: [...byCnpj.values()] };
}
