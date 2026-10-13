import { newsProviderKeyIsSet, type ProviderEnv } from "./news-sentiment-provider";

interface SentimentEnv extends ProviderEnv {
  ANTHROPIC_API_KEY?: string;
}

export interface SentimentSettings {
  labelApiKey: string | undefined;
  providerConfigured: boolean;
}

// #310: the owner confirms the cost before filing labels call the model
// (docs/adr/0065). A code switch rather than an env var, so switching it on
// is a reviewed change.
export const FILING_LABELS_SWITCHED_ON = false;

// Keys are only handed to their clients, never logged or returned to a page;
// a page learns whether a source is on, nothing more.
export function readSentimentSettings(
  env: SentimentEnv = process.env,
  labelsSwitchedOn: boolean = FILING_LABELS_SWITCHED_ON,
): SentimentSettings {
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim();
  return {
    labelApiKey: labelsSwitchedOn && anthropicApiKey ? anthropicApiKey : undefined,
    providerConfigured: newsProviderKeyIsSet(env),
  };
}
