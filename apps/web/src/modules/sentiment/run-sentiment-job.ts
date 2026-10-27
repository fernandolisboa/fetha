import { filingLabelFamily } from "@fetha/prompts";

import type { Database } from "@/db/client";
import { defaultModelCatalog } from "@/modules/ai-models";

import { createAnthropicFilingLabelClient, type FilingLabelClient } from "./filing-label-model";
import { labelFilings, type LabelFilingsOutcome } from "./label-filings";
import {
  newsSentimentProviderFromEnv,
  type NewsSentimentProvider,
} from "./news-sentiment-provider";
import { refreshNewsTone, type NewsToneOutcome } from "./news-tone-job";
import { refreshProviderArticles, type ProviderArticlesOutcome } from "./provider-articles-job";
import { readSentimentSettings } from "./settings";
import { sentimentUniverse, type SentimentUniverse } from "./universe";

export interface SentimentJobOutcome {
  labels: LabelFilingsOutcome;
  newsTone: NewsToneOutcome;
  provider: ProviderArticlesOutcome;
}

export interface SentimentJobOptions {
  deadlineAt: number;
  now?: Date;
  fetchImpl?: typeof fetch;
  labelClient?: FilingLabelClient | null;
  provider?: NewsSentimentProvider | null;
  sleep?: (ms: number) => Promise<void>;
}

const failedLabels: LabelFilingsOutcome = {
  status: "failed",
  labelled: 0,
  rejected: 0,
  unreadable: 0,
  retryLater: 0,
  deferred: 0,
};
const failedNewsTone: NewsToneOutcome = { status: "failed", refreshed: 0, failed: 0, deferred: 0 };
const failedProvider: ProviderArticlesOutcome = {
  status: "failed",
  refreshed: 0,
  articles: 0,
  failed: 0,
  deferred: 0,
};

function logFailure(step: string, error: unknown): void {
  console.error(`sentiment ${step} failed`, error instanceof Error ? error.name : "Unknown");
}

async function guarded<T>(step: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logFailure(step, error);
    return fallback;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The nightly sentiment step (docs/adr/0065): labels, GDELT tone and the
// paid provider talk to three different hosts with their own spacing, so
// they run side by side under the run's deadline. Each one's failure is
// reported alongside the others, never thrown into the nightly run.
export async function runSentimentJob(
  db: Database,
  options: SentimentJobOptions,
): Promise<SentimentJobOutcome> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const settings = readSentimentSettings();
  const labelApiKey = settings.labelApiKey;
  const labelClient =
    options.labelClient !== undefined
      ? options.labelClient
      : labelApiKey
        ? createAnthropicFilingLabelClient(
            labelApiKey,
            await defaultModelCatalog.resolveModel(filingLabelFamily, labelApiKey),
            (modelId) => {
              defaultModelCatalog.markRejected(labelApiKey, modelId);
            },
          )
        : null;
  const provider =
    options.provider !== undefined
      ? options.provider
      : newsSentimentProviderFromEnv(process.env, fetchImpl);

  let universe: SentimentUniverse;
  try {
    universe = await sentimentUniverse(db);
  } catch (error) {
    logFailure("universe", error);
    return { labels: failedLabels, newsTone: failedNewsTone, provider: failedProvider };
  }
  const { deadlineAt } = options;
  const [labels, newsTone, providerOutcome] = await Promise.all([
    guarded(
      "labels",
      () =>
        labelFilings(db, {
          client: labelClient,
          cnpjs: universe.companies.map((company) => company.cnpj),
          watchedCnpjs: universe.companies
            .filter((company) => company.watched)
            .map((company) => company.cnpj),
          fetchImpl,
          now,
          deadlineAt,
          sleep,
        }),
      failedLabels,
    ),
    guarded(
      "news tone",
      () =>
        refreshNewsTone(db, { companies: universe.companies, fetchImpl, now, deadlineAt, sleep }),
      failedNewsTone,
    ),
    guarded(
      "provider",
      () =>
        refreshProviderArticles(db, {
          provider,
          tickers: universe.tickers,
          watchedTickers: universe.watchedTickers,
          now,
          deadlineAt,
        }),
      failedProvider,
    ),
  ]);
  return { labels, newsTone, provider: providerOutcome };
}
