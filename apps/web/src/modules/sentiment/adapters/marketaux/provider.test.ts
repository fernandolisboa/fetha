import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createMarketauxProvider, marketauxUrl, parseMarketauxBody } from "./provider";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

const now = new Date("2026-10-13T03:00:00Z");

describe("marketauxUrl", () => {
  it("asks for the last week of entity-filtered news on the B3 symbols", () => {
    const url = new URL(marketauxUrl(["PETR4"], "secret", now));
    expect(url.origin + url.pathname).toBe("https://api.marketaux.com/v1/news/all");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      symbols: "PETR4.SA",
      filter_entities: "true",
      must_have_entities: "true",
      language: "pt,en",
      published_after: "2026-10-06T03:00",
      limit: "3",
      api_token: "secret",
    });
  });
});

describe("parseMarketauxBody", () => {
  it("keeps one article per scored entity on a requested ticker", () => {
    const result = parseMarketauxBody(200, fixture("news-all.json"), ["PETR4"]);
    expect(result).toEqual({
      kind: "ok",
      articles: [
        {
          articleId: "6f2c1a90-3b7e-4c1d-9a55-0e1f2a3b4c5d",
          ticker: "PETR4",
          title: "Petrobras anuncia nova descoberta no pré-sal",
          url: "https://www.exemplo-noticias.com.br/petrobras-descoberta-pre-sal",
          source: "exemplo-noticias.com.br",
          publishedAt: new Date("2026-10-12T14:05:00Z"),
          sentiment: "0.6124",
        },
        {
          articleId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e",
          ticker: "PETR4",
          title: "Petrobras faces lawsuit over fuel pricing",
          url: "https://www.example-news.com/petrobras-lawsuit",
          source: "example-news.com",
          publishedAt: new Date("2026-10-11T09:30:00Z"),
          sentiment: "-0.4519",
        },
      ],
    });
  });

  it("reads the plan's limits as rate limited and other errors as failures", () => {
    expect(parseMarketauxBody(402, fixture("usage-limit-reached.json"), ["PETR4"])).toEqual({
      kind: "rate_limited",
    });
    expect(parseMarketauxBody(429, null, ["PETR4"])).toEqual({ kind: "rate_limited" });
    expect(parseMarketauxBody(401, fixture("invalid-api-token.json"), ["PETR4"])).toEqual({
      kind: "failed",
      reason: "invalid_api_token",
    });
    expect(parseMarketauxBody(500, "oops", ["PETR4"])).toEqual({
      kind: "failed",
      reason: "HTTP 500",
    });
  });

  it("rejects an article whose link is not https", () => {
    const news = fixture("news-all.json") as { data: { url: string }[] };
    const first = news.data[0];
    if (first) {
      first.url = "javascript:alert(1)";
    }
    expect(parseMarketauxBody(200, news, ["PETR4"])).toEqual({
      kind: "failed",
      reason: "unexpected shape",
    });
  });
});

describe("createMarketauxProvider", () => {
  it("fails without throwing when the provider does not answer with JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response("<html>")));
    const provider = createMarketauxProvider("secret", fetchImpl);
    expect(await provider.latestArticles(["PETR4"], now)).toEqual({
      kind: "failed",
      reason: "no response",
    });
  });
});
