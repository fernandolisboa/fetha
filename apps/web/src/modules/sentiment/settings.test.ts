import { describe, expect, it, vi } from "vitest";

import { newsSentimentProviderFromEnv } from "./news-sentiment-provider";
import { FILING_LABELS_SWITCHED_ON, readSentimentSettings } from "./settings";

describe("readSentimentSettings", () => {
  it("has filing labels switched on, as the owner confirmed (#310)", () => {
    expect(FILING_LABELS_SWITCHED_ON).toBe(true);
    expect(
      readSentimentSettings({ ANTHROPIC_API_KEY: "key", VERCEL_ENV: "production" }).labelApiKey,
    ).toBe("key");
  });

  it("keeps the Anthropic key from labels while switched off", () => {
    expect(
      readSentimentSettings({ ANTHROPIC_API_KEY: "key", VERCEL_ENV: "production" }, false)
        .labelApiKey,
    ).toBeUndefined();
  });

  it("labels only on the production deployment, never on previews or locally", () => {
    expect(
      readSentimentSettings({ ANTHROPIC_API_KEY: "key", VERCEL_ENV: "preview" }).labelApiKey,
    ).toBeUndefined();
    expect(readSentimentSettings({ ANTHROPIC_API_KEY: "key" }).labelApiKey).toBeUndefined();
  });

  it("hands the trimmed Anthropic key to labels once switched on", () => {
    const production = { VERCEL_ENV: "production" };
    expect(readSentimentSettings({ ...production, ANTHROPIC_API_KEY: " key " }).labelApiKey).toBe(
      "key",
    );
    expect(
      readSentimentSettings({ ...production, ANTHROPIC_API_KEY: " " }).labelApiKey,
    ).toBeUndefined();
    expect(readSentimentSettings(production).labelApiKey).toBeUndefined();
  });

  it("reports whether a paid news provider is configured", () => {
    expect(readSentimentSettings({ MARKETAUX_API_TOKEN: "token" }).providerConfigured).toBe(true);
    expect(readSentimentSettings({ MARKETAUX_API_TOKEN: "" }).providerConfigured).toBe(false);
  });
});

describe("newsSentimentProviderFromEnv", () => {
  it("is a no-op without a key", () => {
    expect(newsSentimentProviderFromEnv({}, fetch)).toBeNull();
    expect(newsSentimentProviderFromEnv({ MARKETAUX_API_TOKEN: "  " }, fetch)).toBeNull();
  });

  it("picks Marketaux when its key is set and sends the key only to Marketaux", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }))),
    );
    const provider = newsSentimentProviderFromEnv({ MARKETAUX_API_TOKEN: "token" }, fetchImpl);
    expect(provider?.name).toBe("marketaux");
    await provider?.latestArticles(["VALE3"], new Date("2026-10-13T03:00:00Z"));
    const url = new URL(fetchImpl.mock.calls[0]?.[0] as string);
    expect(url.hostname).toBe("api.marketaux.com");
    expect(url.searchParams.get("api_token")).toBe("token");
  });
});
