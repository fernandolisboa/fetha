import { Decimal } from "decimal.js";
import type { DecimalString } from "@fetha/contracts";

import type {
  NewsSentimentProvider,
  ProviderArticle,
  ProviderResult,
} from "../../news-sentiment-provider";

import { marketauxErrorSchema, marketauxNewsSchema, type MarketauxNews } from "./schema";

const ENDPOINT = "https://api.marketaux.com/v1/news/all";
const TIMEOUT_MS = 15_000;
const LOOKBACK_DAYS = 7;
// The free plan returns at most three articles a request (marketaux.com/pricing).
const ARTICLES_PER_REQUEST = 3;
const RATE_LIMIT_CODES = new Set(["usage_limit_reached", "rate_limit_reached"]);

export function marketauxSymbol(ticker: string): string {
  return `${ticker}.SA`;
}

function publishedAfter(now: Date): string {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return since.toISOString().slice(0, 16);
}

export function marketauxUrl(tickers: readonly string[], token: string, now: Date): string {
  const params = new URLSearchParams({
    symbols: tickers.map(marketauxSymbol).join(","),
    filter_entities: "true",
    must_have_entities: "true",
    language: "pt,en",
    published_after: publishedAfter(now),
    limit: String(ARTICLES_PER_REQUEST),
    api_token: token,
  });
  return `${ENDPOINT}?${params.toString()}`;
}

// One article per ticker it scores; an entity with no score is skipped.
export function articlesFromNews(
  news: MarketauxNews,
  tickers: readonly string[],
): ProviderArticle[] {
  const tickerOf = new Map(tickers.map((ticker) => [marketauxSymbol(ticker), ticker]));
  return news.data.flatMap((article) =>
    article.entities.flatMap((entity) => {
      const ticker = tickerOf.get(entity.symbol);
      if (ticker === undefined || entity.sentiment_score === null) {
        return [];
      }
      return [
        {
          articleId: article.uuid,
          ticker,
          title: article.title,
          url: article.url,
          source: article.source,
          publishedAt: new Date(article.published_at),
          sentiment: new Decimal(entity.sentiment_score).toFixed(4) as DecimalString,
        },
      ];
    }),
  );
}

export function parseMarketauxBody(
  status: number,
  body: unknown,
  tickers: readonly string[],
): ProviderResult {
  if (status !== 200) {
    const error = marketauxErrorSchema.safeParse(body);
    if (status === 429 || (error.success && RATE_LIMIT_CODES.has(error.data.error.code))) {
      return { kind: "rate_limited" };
    }
    return {
      kind: "failed",
      reason: error.success ? error.data.error.code : `HTTP ${String(status)}`,
    };
  }
  const news = marketauxNewsSchema.safeParse(body);
  return news.success
    ? { kind: "ok", articles: articlesFromNews(news.data, tickers) }
    : { kind: "failed", reason: "unexpected shape" };
}

export function createMarketauxProvider(
  token: string,
  fetchImpl: typeof fetch,
): NewsSentimentProvider {
  return {
    name: "marketaux",
    async latestArticles(tickers, now): Promise<ProviderResult> {
      let response: Response;
      let body: unknown;
      try {
        response = await fetchImpl(marketauxUrl(tickers, token, now), {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        body = await response.json();
      } catch {
        return { kind: "failed", reason: "no response" };
      }
      return parseMarketauxBody(response.status, body, tickers);
    },
  };
}
