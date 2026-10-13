import type { Ticker } from "@fetha/contracts";

export interface MarketIndex {
  ticker: Ticker;
  b3Code: string;
  shortLabel: string;
  aliases: readonly string[];
}

// Membership ("this ticker is a market index, not a tradable instrument") is a code constant
// (ADR-0062), not a column: one entry, the Ibovespa. The registry keys IBOV
// options to `IBOV11` (the join key `option_series.underlying` carries); `IBOV` is only the B3
// index-statistics service's own request code.
export const marketIndexes = [
  {
    ticker: "IBOV11",
    b3Code: "IBOV",
    shortLabel: "IBOV",
    aliases: ["ibov", "ibovespa"],
  },
] as const satisfies readonly MarketIndex[];

// The one entry above, named: every reader outside the search/membership helpers below wants
// "the Ibovespa itself" (the fetch adapter's own request code, the shell's market bar, the
// nightly ingest's candle writer), not a position in an array that happens to hold one row.
export const ibovespa = marketIndexes[0];

const byTicker = new Map<string, MarketIndex>(marketIndexes.map((index) => [index.ticker, index]));

export function isMarketIndex(ticker: string): boolean {
  return byTicker.has(ticker);
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalize(value: string): string {
  return stripDiacritics(value).toLowerCase().trim();
}

// Alias prefix match for `searchInstruments` (ADR-0062): "ibovespa" finds
// `IBOV11` even though it is not itself a prefix of the ticker; "ibov" already matches by the
// ticker's own prefix, so this only ever adds a ticker, never duplicates the plain `LIKE` hit.
export function marketIndexTickersForQuery(query: string): Ticker[] {
  const needle = normalize(query);
  if (needle === "") {
    return [];
  }
  const tickers: Ticker[] = [];
  for (const index of marketIndexes) {
    const matches = index.aliases.some((alias) => normalize(alias).startsWith(needle));
    if (matches) {
      tickers.push(index.ticker);
    }
  }
  return tickers;
}
