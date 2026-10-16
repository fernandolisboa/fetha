import { readAnthropicApiKey } from "@/modules/ai-models";

import { newsProviderKeyIsSet, type ProviderEnv } from "./news-sentiment-provider";

interface SentimentEnv extends ProviderEnv {
  ANTHROPIC_API_KEY?: string;
  VERCEL_ENV?: string;
}

export interface SentimentSettings {
  labelApiKey: string | undefined;
  providerConfigured: boolean;
}

// #310: the owner confirmed the cost on 2026-10-13 (docs/adr/0065). A code
// switch rather than an env var, so turning it off or on is a reviewed change.
// Production only: the e2e suite runs the owner's manual ingestion on every
// PR preview, which would otherwise pay to label the same filings each time.
export const FILING_LABELS_SWITCHED_ON = true;

// Keys are only handed to their clients, never logged or returned to a page;
// a page learns whether a source is on, nothing more.
export function readSentimentSettings(
  env: SentimentEnv = process.env,
  labelsSwitchedOn: boolean = FILING_LABELS_SWITCHED_ON,
): SentimentSettings {
  const anthropicApiKey = readAnthropicApiKey(env);
  const labelsOn = labelsSwitchedOn && env.VERCEL_ENV === "production";
  return {
    labelApiKey: labelsOn && anthropicApiKey ? anthropicApiKey : undefined,
    providerConfigured: newsProviderKeyIsSet(env),
  };
}
