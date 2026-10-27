import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { DecimalString } from "@fetha/contracts";

import type { Database } from "@/db/client";
import {
  newsArticles,
  newsTonePoints,
  sentimentFetches,
  type NewsProvider,
  type SentimentFetchSource,
  type SentimentFetchStatus,
} from "../schema";

export interface NewsTonePoint {
  day: string;
  tone: DecimalString;
  articles: number;
}

export interface SentimentFetch {
  subject: string;
  query: string | null;
  status: SentimentFetchStatus;
  fetchedAt: Date;
}

export interface NewsArticle {
  provider: NewsProvider;
  articleId: string;
  ticker: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  sentiment: DecimalString;
}

export async function sentimentFetchesOf(
  db: Database,
  source: SentimentFetchSource,
  subjects: readonly string[],
): Promise<SentimentFetch[]> {
  if (subjects.length === 0) {
    return [];
  }
  return db
    .select({
      subject: sentimentFetches.subject,
      query: sentimentFetches.query,
      status: sentimentFetches.status,
      fetchedAt: sentimentFetches.fetchedAt,
    })
    .from(sentimentFetches)
    .where(
      and(eq(sentimentFetches.source, source), inArray(sentimentFetches.subject, [...subjects])),
    );
}

export async function recordSentimentFetch(
  db: Database,
  source: SentimentFetchSource,
  subject: string,
  query: string | null,
  status: SentimentFetchStatus,
): Promise<void> {
  await db
    .insert(sentimentFetches)
    .values({ source, subject, query, status })
    .onConflictDoUpdate({
      target: [sentimentFetches.source, sentimentFetches.subject],
      set: { query, status, fetchedAt: sql`now()` },
    });
}

export async function upsertNewsTonePoints(
  db: Database,
  cnpj: string,
  points: readonly NewsTonePoint[],
): Promise<number> {
  if (points.length === 0) {
    return 0;
  }
  const rows = await db
    .insert(newsTonePoints)
    .values(points.map((point) => ({ cnpj, ...point })))
    .onConflictDoUpdate({
      target: [newsTonePoints.cnpj, newsTonePoints.day],
      set: {
        tone: sql`excluded.tone`,
        articles: sql`excluded.articles`,
        fetchedAt: sql`now()`,
      },
    })
    .returning({ day: newsTonePoints.day });
  return rows.length;
}

export async function newsTonePointsSince(
  db: Database,
  cnpj: string,
  since: string,
  before?: string,
): Promise<NewsTonePoint[]> {
  return db
    .select({
      day: newsTonePoints.day,
      tone: newsTonePoints.tone,
      articles: newsTonePoints.articles,
    })
    .from(newsTonePoints)
    .where(
      and(
        eq(newsTonePoints.cnpj, cnpj),
        gte(newsTonePoints.day, since),
        before === undefined ? undefined : lt(newsTonePoints.day, before),
      ),
    )
    .orderBy(newsTonePoints.day);
}

export async function insertNewsArticles(
  db: Database,
  articles: readonly NewsArticle[],
): Promise<number> {
  if (articles.length === 0) {
    return 0;
  }
  const rows = await db
    .insert(newsArticles)
    .values([...articles])
    .onConflictDoNothing({
      target: [newsArticles.provider, newsArticles.articleId, newsArticles.ticker],
    })
    .returning({ articleId: newsArticles.articleId });
  return rows.length;
}

export async function latestNewsArticles(
  db: Database,
  ticker: string,
  limit: number,
  until?: Date,
): Promise<NewsArticle[]> {
  return db
    .select({
      provider: newsArticles.provider,
      articleId: newsArticles.articleId,
      ticker: newsArticles.ticker,
      title: newsArticles.title,
      url: newsArticles.url,
      source: newsArticles.source,
      publishedAt: newsArticles.publishedAt,
      sentiment: newsArticles.sentiment,
    })
    .from(newsArticles)
    .where(
      and(
        eq(newsArticles.ticker, ticker),
        until === undefined ? undefined : lte(newsArticles.publishedAt, until),
      ),
    )
    .orderBy(desc(newsArticles.publishedAt))
    .limit(limit);
}
