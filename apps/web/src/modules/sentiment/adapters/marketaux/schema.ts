import { z } from "zod";

// GET /v1/news/all (marketaux.com/documentation). Unknown fields are
// dropped, not rejected: the provider adds fields without notice.
const entitySchema = z.object({
  symbol: z.string(),
  sentiment_score: z.number().min(-1).max(1).nullable(),
});

const articleSchema = z.object({
  uuid: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(500),
  url: z.url({ protocol: /^https$/ }).max(2000),
  source: z.string().trim().min(1).max(200),
  published_at: z.iso.datetime({ offset: true }),
  entities: z.array(entitySchema).max(50),
});

export const marketauxNewsSchema = z.object({
  data: z.array(articleSchema).max(100),
});
export type MarketauxNews = z.infer<typeof marketauxNewsSchema>;

export const marketauxErrorSchema = z.object({
  error: z.object({ code: z.string() }),
});
