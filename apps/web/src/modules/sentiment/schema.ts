import { sql } from "drizzle-orm";
import {
  filingTones,
  filingTopics,
  type DecimalString,
  type FilingTone,
  type FilingTopic,
} from "@fetha/contracts";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { companyFilings } from "../market-data/schema";

export const filingLabelOutcomeValues = ["labelled", "rejected", "unreadable", "pending"] as const;
export type FilingLabelOutcome = (typeof filingLabelOutcomeValues)[number];

// Why a filing ended without a label (docs/adr/0065): a closed list, never
// the model's or the server's own text.
export const filingLabelReasonValues = [
  "refusal",
  "incomplete",
  "schema",
  "figure",
  "link",
  "bad_request",
  "not_pdf",
  "too_large",
  "unavailable",
] as const;
export type FilingLabelReason = (typeof filingLabelReasonValues)[number];

function inList(column: string, values: readonly string[]) {
  return sql.raw(`${column} in (${values.map((value) => `'${value}'`).join(", ")})`);
}

// One row per filing version the nightly job looked at (docs/adr/0065).
// Shared reference data, written only by that job. A final outcome is never
// rewritten; `pending` counts download attempts until one succeeds or the
// filing is given up as unreadable.
export const filingLabels = pgTable(
  "filing_labels",
  {
    protocol: text("protocol").notNull(),
    version: integer("version").notNull(),
    outcome: text("outcome").$type<FilingLabelOutcome>().notNull(),
    topic: text("topic").$type<FilingTopic>(),
    tone: text("tone").$type<FilingTone>(),
    summary: text("summary"),
    reason: text("reason").$type<FilingLabelReason>(),
    attempts: integer("attempts").notNull().default(0),
    model: text("model"),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.protocol, table.version] }),
    foreignKey({
      columns: [table.protocol, table.version],
      foreignColumns: [companyFilings.protocol, companyFilings.version],
      name: "filing_labels_company_filing_fk",
    }),
    check("filing_labels_outcome_check", inList("outcome", filingLabelOutcomeValues)),
    check("filing_labels_topic_check", sql`topic is null or ${inList("topic", filingTopics)}`),
    check("filing_labels_tone_check", sql`tone is null or ${inList("tone", filingTones)}`),
    check(
      "filing_labels_reason_check",
      sql`reason is null or ${inList("reason", filingLabelReasonValues)}`,
    ),
    check(
      "filing_labels_labelled_check",
      sql`(outcome = 'labelled') = (topic is not null and tone is not null and summary is not null)`,
    ),
  ],
);

// GDELT's daily tone and article count for one company's news query
// (docs/adr/0065). The source revises recent days as it indexes more
// articles, so a later fetch replaces a day's point.
export const newsTonePoints = pgTable(
  "news_tone_points",
  {
    cnpj: text("cnpj").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    tone: numeric("tone", { precision: 8, scale: 4 }).$type<DecimalString>().notNull(),
    articles: integer("articles").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.cnpj, table.day] })],
);

// Paid news providers behind the NewsSentimentProvider seam (docs/adr/0065).
export const newsProviderValues = ["marketaux"] as const;
export type NewsProvider = (typeof newsProviderValues)[number];

export const sentimentFetchSourceValues = ["gdelt", ...newsProviderValues] as const;
export type SentimentFetchSource = (typeof sentimentFetchSourceValues)[number];

export const sentimentFetchStatusValues = ["ok", "rate_limited", "failed"] as const;
export type SentimentFetchStatus = (typeof sentimentFetchStatusValues)[number];

// When each news source was last asked about each subject (a company's CNPJ
// for GDELT, a ticker for a paid provider), so every night spreads its
// requests over the subjects asked about longest ago.
export const sentimentFetches = pgTable(
  "sentiment_fetches",
  {
    source: text("source").$type<SentimentFetchSource>().notNull(),
    subject: text("subject").notNull(),
    query: text("query"),
    status: text("status").$type<SentimentFetchStatus>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.subject] }),
    check("sentiment_fetches_source_check", inList("source", sentimentFetchSourceValues)),
    check("sentiment_fetches_status_check", inList("status", sentimentFetchStatusValues)),
  ],
);

// Articles a paid news provider returned for a ticker, with the provider's
// own sentiment score for that ticker (docs/adr/0065). Insert-only.
export const newsArticles = pgTable(
  "news_articles",
  {
    provider: text("provider").$type<NewsProvider>().notNull(),
    articleId: text("article_id").notNull(),
    ticker: text("ticker").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    source: text("source").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    sentiment: numeric("sentiment", { precision: 5, scale: 4 }).$type<DecimalString>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.articleId, table.ticker] }),
    index("news_articles_ticker_published_at_idx").on(table.ticker, table.publishedAt),
    check("news_articles_provider_check", inList("provider", newsProviderValues)),
  ],
);
