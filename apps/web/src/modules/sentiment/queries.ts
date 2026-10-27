import type { FilingCategory, FilingTone, FilingTopic } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { companiesOfTickers, filingsOfCompaniesSince } from "@/modules/market-data";

import { labelWindowStart } from "./label-filings";
import { storedFilingLabels } from "./repositories/filing-label-repository";
import {
  latestNewsArticles,
  newsTonePointsSince,
  sentimentFetchesOf,
  type NewsArticle,
  type NewsTonePoint,
} from "./repositories/news-repository";
import type { SentimentFetchStatus } from "./schema";
import { averageTone, toneCounts, type AverageTone, type ToneCounts } from "./sentiment-summary";
import { readSentimentSettings } from "./settings";

const LATEST_LABELS = 5;
const LATEST_ARTICLES = 5;
const NEWS_WINDOW_DAYS = 90;
export const AVERAGE_WINDOW_DAYS = 30;

export interface LabelledFilingView {
  protocol: string;
  deliveredOn: string;
  category: FilingCategory;
  documentUrl: string;
  topic: FilingTopic;
  tone: FilingTone;
  summary: string;
}

export interface SentimentView {
  // Whether the ticker maps to a listed company: only companies file with
  // the CVM and get a GDELT query.
  mapped: boolean;
  filings: {
    enabled: boolean;
    counts: ToneCounts;
    labelled: number;
    // Filings in the window without a final label yet.
    waiting: number;
    // Filings that ended without a label (unreadable file, discarded reply),
    // so the tone counts are read against every filing in the window.
    unlabelled: number;
    latest: LabelledFilingView[];
  };
  newsTone: {
    query: string | null;
    status: SentimentFetchStatus | null;
    fetchedAt: Date | null;
    points: NewsTonePoint[];
    average: AverageTone | null;
  };
  provider: {
    enabled: boolean;
    articles: NewsArticle[];
  };
}

function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// The asset page's "Sentimento" read model (docs/adr/0065). Everything here
// is shared reference data; nothing depends on who is looking.
export async function sentimentForInstrument(
  db: Database,
  ticker: string,
  now: Date = new Date(),
): Promise<SentimentView> {
  const settings = readSentimentSettings();
  const [[company], articles] = await Promise.all([
    companiesOfTickers(db, [ticker]),
    latestNewsArticles(db, ticker, LATEST_ARTICLES),
  ]);
  const provider = { enabled: settings.providerConfigured, articles };
  const filingsEnabled = settings.labelApiKey !== undefined;
  if (!company) {
    return {
      mapped: false,
      filings: {
        enabled: filingsEnabled,
        counts: toneCounts([]),
        labelled: 0,
        waiting: 0,
        unlabelled: 0,
        latest: [],
      },
      newsTone: { query: null, status: null, fetchedAt: null, points: [], average: null },
      provider,
    };
  }

  const [filings, [fetch], points] = await Promise.all([
    filingsOfCompaniesSince(db, [company.cnpj], labelWindowStart(now)),
    sentimentFetchesOf(db, "gdelt", [company.cnpj]),
    newsTonePointsSince(db, company.cnpj, daysBefore(now, NEWS_WINDOW_DAYS)),
  ]);
  const labels = await storedFilingLabels(db, filings);
  const labelOf = new Map(
    labels.map((label) => [`${label.protocol}:${String(label.version)}`, label]),
  );
  const latest: LabelledFilingView[] = [];
  const tones: FilingTone[] = [];
  let waiting = 0;
  let unlabelled = 0;
  for (const filing of filings) {
    const label = labelOf.get(`${filing.protocol}:${String(filing.version)}`);
    if (label === undefined || label.outcome === "pending") {
      waiting += 1;
      continue;
    }
    if (label.outcome !== "labelled" || !label.topic || !label.tone || !label.summary) {
      unlabelled += 1;
      continue;
    }
    tones.push(label.tone);
    if (latest.length < LATEST_LABELS) {
      latest.push({
        protocol: filing.protocol,
        deliveredOn: filing.deliveredOn,
        category: filing.category,
        documentUrl: filing.documentUrl,
        topic: label.topic,
        tone: label.tone,
        summary: label.summary,
      });
    }
  }

  return {
    mapped: true,
    filings: {
      enabled: filingsEnabled,
      counts: toneCounts(tones),
      labelled: tones.length,
      waiting,
      unlabelled,
      latest,
    },
    newsTone: {
      query: fetch?.query ?? null,
      status: fetch?.status ?? null,
      fetchedAt: fetch?.fetchedAt ?? null,
      points,
      average: averageTone(points, daysBefore(now, AVERAGE_WINDOW_DAYS)),
    },
    provider,
  };
}
