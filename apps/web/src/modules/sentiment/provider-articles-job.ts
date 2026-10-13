import type { Database } from "@/db/client";

import type { NewsSentimentProvider } from "./news-sentiment-provider";
import {
  insertNewsArticles,
  recordSentimentFetch,
  sentimentFetchesOf,
} from "./repositories/news-repository";

const ITEM_BUDGET_MS = 20_000;
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000;
// Marketaux's free plan allows 100 requests a day across three nightly runs.
const MAX_REQUESTS_PER_RUN = 30;

export interface ProviderArticlesOutcome {
  status: "off" | "ran" | "rate_limited" | "failed";
  refreshed: number;
  articles: number;
  failed: number;
  deferred: number;
}

export interface ProviderArticlesOptions {
  provider: NewsSentimentProvider | null;
  tickers: readonly string[];
  now: Date;
  deadlineAt: number;
}

export async function refreshProviderArticles(
  db: Database,
  options: ProviderArticlesOptions,
): Promise<ProviderArticlesOutcome> {
  const { provider } = options;
  const outcome: ProviderArticlesOutcome = {
    status: provider ? "ran" : "off",
    refreshed: 0,
    articles: 0,
    failed: 0,
    deferred: 0,
  };
  if (!provider) {
    return outcome;
  }
  const source = provider.name;
  const fetches = await sentimentFetchesOf(db, source, options.tickers);
  const lastFetch = new Map(fetches.map((row) => [row.subject, row.fetchedAt.getTime()]));
  const due = options.tickers
    .filter((ticker) => {
      const at = lastFetch.get(ticker);
      return at === undefined || options.now.getTime() - at >= REFRESH_AFTER_MS;
    })
    .sort((a, b) => (lastFetch.get(a) ?? 0) - (lastFetch.get(b) ?? 0));

  for (const [index, ticker] of due.entries()) {
    if (index >= MAX_REQUESTS_PER_RUN || Date.now() + ITEM_BUDGET_MS > options.deadlineAt) {
      outcome.deferred = due.length - index;
      break;
    }
    const result = await provider.latestArticles([ticker], options.now);
    if (result.kind === "rate_limited") {
      outcome.status = "rate_limited";
      outcome.deferred = due.length - index;
      break;
    }
    if (result.kind === "failed") {
      await recordSentimentFetch(db, source, ticker, null, "failed");
      outcome.failed += 1;
      continue;
    }
    outcome.articles += await insertNewsArticles(
      db,
      result.articles.map((article) => ({ ...article, provider: provider.name })),
    );
    await recordSentimentFetch(db, source, ticker, null, "ok");
    outcome.refreshed += 1;
  }
  return outcome;
}
