import type { Database } from "@/db/client";

import { fetchGdeltTimeline, mergeGdeltTimelines } from "./adapters/gdelt/fetch";
import { gdeltQuery } from "./adapters/gdelt/query";
import {
  recordSentimentFetch,
  sentimentFetchesOf,
  upsertNewsTonePoints,
} from "./repositories/news-repository";
import type { SentimentCompany } from "./universe";

// GDELT asks for at most one request every five seconds (docs/adr/0065).
const REQUEST_SPACING_MS = 6_000;
// Two requests (15 s timeout each) and their spacing.
const ITEM_BUDGET_MS = 45_000;
// A company is asked about again once a day; three nightly runs share the
// list, oldest first.
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000;

export interface NewsToneOutcome {
  status: "ran" | "rate_limited" | "failed";
  refreshed: number;
  failed: number;
  deferred: number;
}

export interface NewsToneOptions {
  companies: readonly SentimentCompany[];
  fetchImpl: typeof fetch;
  now: Date;
  deadlineAt: number;
  sleep: (ms: number) => Promise<void>;
}

export async function refreshNewsTone(
  db: Database,
  options: NewsToneOptions,
): Promise<NewsToneOutcome> {
  const outcome: NewsToneOutcome = { status: "ran", refreshed: 0, failed: 0, deferred: 0 };
  const fetches = await sentimentFetchesOf(
    db,
    "gdelt",
    options.companies.map((company) => company.cnpj),
  );
  const lastFetch = new Map(fetches.map((row) => [row.subject, row.fetchedAt.getTime()]));
  const throttled = new Set(
    fetches.filter((row) => row.status === "rate_limited").map((row) => row.subject),
  );
  const due = options.companies
    .filter((company) => {
      const at = lastFetch.get(company.cnpj);
      return (
        at === undefined ||
        throttled.has(company.cnpj) ||
        options.now.getTime() - at >= REFRESH_AFTER_MS
      );
    })
    .sort(
      (a, b) =>
        Number(b.watched) - Number(a.watched) ||
        (lastFetch.get(a.cnpj) ?? 0) - (lastFetch.get(b.cnpj) ?? 0),
    );

  let requests = 0;
  const spaced = async <T>(request: () => Promise<T>): Promise<T> => {
    if (requests > 0) {
      await options.sleep(REQUEST_SPACING_MS);
    }
    requests += 1;
    return request();
  };

  for (const [index, company] of due.entries()) {
    if (Date.now() + ITEM_BUDGET_MS > options.deadlineAt) {
      outcome.deferred = due.length - index;
      break;
    }
    const query = gdeltQuery(company.companyName, company.tickers);
    if (query === null) {
      continue;
    }
    const step = await refreshCompany(db, company.cnpj, query, options.fetchImpl, spaced);
    if (step === "rate_limited") {
      outcome.status = "rate_limited";
      outcome.deferred = due.length - index;
      break;
    }
    outcome[step] += 1;
  }
  return outcome;
}

async function refreshCompany(
  db: Database,
  cnpj: string,
  query: string,
  fetchImpl: typeof fetch,
  spaced: <T>(request: () => Promise<T>) => Promise<T>,
): Promise<"refreshed" | "failed" | "rate_limited"> {
  const tone = await spaced(() => fetchGdeltTimeline(query, "timelinetone", fetchImpl));
  const volume =
    tone.kind === "ok"
      ? await spaced(() => fetchGdeltTimeline(query, "timelinevolraw", fetchImpl))
      : tone;
  if (volume.kind === "rate_limited" || tone.kind === "rate_limited") {
    // Its points are left as they were and it stays due, so the panel can
    // say the last attempt was throttled and the next run asks again.
    await recordSentimentFetch(db, "gdelt", cnpj, query, "rate_limited");
    return "rate_limited";
  }
  const days =
    tone.kind === "ok" && volume.kind === "ok"
      ? mergeGdeltTimelines(tone.value, volume.value)
      : null;
  try {
    if (days?.kind !== "ok") {
      await recordSentimentFetch(db, "gdelt", cnpj, query, "failed");
      return "failed";
    }
    await upsertNewsTonePoints(db, cnpj, days.value);
    await recordSentimentFetch(db, "gdelt", cnpj, query, "ok");
    return "refreshed";
  } catch {
    // A row the database refuses fails this company only; it is recorded so
    // it sorts last tomorrow instead of blocking every company after it.
    await recordSentimentFetch(db, "gdelt", cnpj, query, "failed");
    return "failed";
  }
}
