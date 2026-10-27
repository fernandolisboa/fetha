import type { Database } from "@/db/client";
import { companiesOfTickers, isMarketIndex } from "@/modules/market-data";
import { RESEARCH_WINDOW_SESSIONS, recentFindingUnderlyings } from "@/modules/radar";
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

// The most radar underlyings added on top of the watchlist: the filing labels run on the server
// key, so the universe is bounded rather than the whole market (docs/adr/0065).
export const RADAR_SENTIMENT_TICKERS = 40;

// docs/adr/0065: every watchlist ticker first, then the underlyings the radar found in the
// sessions "Obter sugestões" researches (docs/adr/0076), so a run that defers at its deadline has
// served the watchlist before any radar name. Tickers with no company (ETFs, FIIs, BDRs) still
// get provider articles, never filings or GDELT tone. docs/adr/0062: a market index is excluded,
// its page shows no sentiment panel.
export async function sentimentUniverse(db: Database): Promise<SentimentUniverse> {
  const watched = (await watchedTickersOfAnyUser(db)).filter((ticker) => !isMarketIndex(ticker));
  const found = await recentFindingUnderlyings(db, {
    sessions: RESEARCH_WINDOW_SESSIONS,
    limit: RADAR_SENTIMENT_TICKERS,
    excluding: watched,
  });
  const tickers = [...watched, ...found];
  const rank = new Map(tickers.map((ticker, index) => [ticker, index]));
  const mapped = (await companiesOfTickers(db, tickers)).sort(
    (a, b) => (rank.get(a.ticker) ?? 0) - (rank.get(b.ticker) ?? 0),
  );
  const byCnpj = new Map<string, SentimentCompany>();
  for (const company of mapped) {
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
