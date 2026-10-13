import { describe, expect, it, vi } from "vitest";

import { newsSentimentProviderFromEnv } from "./news-sentiment-provider";
import { FILING_LABELS_SWITCHED_ON, readSentimentSettings } from "./settings";

describe("readSentimentSettings", () => {
  it("keeps filing labels off until the owner switches them on (#310)", () => {
    expect(FILING_LABELS_SWITCHED_ON).toBe(false);
    expect(readSentimentSettings({ ANTHROPIC_API_KEY: "key" }).labelApiKey).toBeUndefined();
  });

  it("hands the Anthropic key to labels only once switched on", () => {
    expect(readSentimentSettings({ ANTHROPIC_API_KEY: " key " }, true).labelApiKey).toBe("key");
    expect(readSentimentSettings({ ANTHROPIC_API_KEY: " " }, true).labelApiKey).toBeUndefined();
    expect(readSentimentSettings({}, true).labelApiKey).toBeUndefined();
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
