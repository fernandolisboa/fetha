import type { DecimalString } from "@fetha/contracts";

import { createMarketauxProvider } from "./adapters/marketaux/provider";
import type { NewsProvider } from "./schema";

export interface ProviderArticle {
  articleId: string;
  ticker: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  // The provider's own score for this ticker, in [-1, 1], as a decimal string.
  sentiment: DecimalString;
}

export type ProviderResult =
  | { kind: "ok"; articles: ProviderArticle[] }
  // Out of requests for now (rate or plan limit): the job stops and the next
  // run tries again.
  | { kind: "rate_limited" }
  | { kind: "failed"; reason: string };

// The paid-news seam (docs/adr/0065): one call, the latest articles about
// these tickers with the provider's sentiment for each ticker. An adapter
// validates its own payload at the edge.
export interface NewsSentimentProvider {
  name: NewsProvider;
  latestArticles(tickers: readonly string[], now: Date): Promise<ProviderResult>;
}

export interface ProviderEnv {
  MARKETAUX_API_TOKEN?: string;
  [key: string]: string | undefined;
}

function marketauxToken(env: ProviderEnv): string | undefined {
  return env.MARKETAUX_API_TOKEN?.trim() || undefined;
}

export function newsProviderKeyIsSet(env: ProviderEnv): boolean {
  return marketauxToken(env) !== undefined;
}

// The provider is chosen by which key is set; no key, no provider. The key
// is only handed to the adapter, never logged or returned.
export function newsSentimentProviderFromEnv(
  env: ProviderEnv,
  fetchImpl: typeof fetch,
): NewsSentimentProvider | null {
  const marketaux = marketauxToken(env);
  if (marketaux) {
    return createMarketauxProvider(marketaux, fetchImpl);
  }
  return null;
}
