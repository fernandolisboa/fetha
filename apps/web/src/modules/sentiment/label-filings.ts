import { checkFilingLabel, filingLabelInputsSchema } from "@fetha/contracts";
import { filingLabelPrompt } from "@fetha/prompts";

import type { Database } from "@/db/client";
import { filingsOfCompaniesSince, type CompanyFilingOfCompany } from "@/modules/market-data";

import { fetchFilingDocument } from "./adapters/rad/fetch-document";
import type { FilingLabelClient, FilingLabelReply } from "./filing-label-model";
import {
  filingLabelStates,
  recordFinalFilingLabel,
  recordPendingAttempt,
  type FinalFilingLabel,
  type LabelCall,
} from "./repositories/filing-label-repository";

// docs/adr/0065: filings of the last 90 days, a watched company's first and newest first within
// each group; RAD throttles
// bursts, so downloads are spaced; a filing RAD will not hand over after
// three nights is given up.
export const LABEL_WINDOW_DAYS = 90;
const MAX_DOWNLOAD_ATTEMPTS = 3;
// Three crons run each night: a failed download waits for the next night, so
// one bad day at RAD costs one attempt, not all three.
const RETRY_AFTER_MS = 20 * 60 * 60 * 1000;
const DOWNLOAD_SPACING_MS = 6_000;
// A download (30s timeout) plus a model call (60s timeout) plus, on a bad
// resolution, one pinned-fallback retry (another 60s, #322 review A4), with
// margin: a filing is only started when it can finish before the deadline.
const ITEM_BUDGET_MS = 160_000;
// Bounds a run's model calls whatever the watchlists hold; a backlog drains
// over the following runs (docs/adr/0065).
export const MAX_LABEL_CALLS_PER_RUN = 60;

export interface LabelFilingsOutcome {
  status: "off" | "ran" | "failed";
  labelled: number;
  rejected: number;
  unreadable: number;
  retryLater: number;
  deferred: number;
}

export interface LabelFilingsOptions {
  client: FilingLabelClient | null;
  cnpjs: readonly string[];
  watchedCnpjs: readonly string[];
  fetchImpl: typeof fetch;
  now: Date;
  deadlineAt: number;
  sleep: (ms: number) => Promise<void>;
}

function emptyOutcome(status: LabelFilingsOutcome["status"]): LabelFilingsOutcome {
  return { status, labelled: 0, rejected: 0, unreadable: 0, retryLater: 0, deferred: 0 };
}

export function labelWindowStart(now: Date): string {
  const start = new Date(now.getTime() - LABEL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}

function callOf(reply: Extract<FilingLabelReply, { usage: unknown }>): LabelCall {
  return {
    model: reply.model,
    promptVersion: filingLabelPrompt.version,
    inputTokens: reply.usage.inputTokens,
    outputTokens: reply.usage.outputTokens,
  };
}

type ReplyResult =
  { kind: "final"; label: FinalFilingLabel; call: LabelCall | null } | { kind: "api_error" };

export function resultOfReply(reply: FilingLabelReply): ReplyResult {
  switch (reply.kind) {
    case "parsed": {
      const check = checkFilingLabel(reply.output);
      return {
        kind: "final",
        label: check.ok
          ? { outcome: "labelled", ...check.label }
          : { outcome: "rejected", reason: check.problem },
        call: callOf(reply),
      };
    }
    case "refusal":
      return {
        kind: "final",
        label: { outcome: "rejected", reason: "refusal" },
        call: callOf(reply),
      };
    case "incomplete":
      return {
        kind: "final",
        label: { outcome: "rejected", reason: "incomplete" },
        call: callOf(reply),
      };
    case "bad_request":
      return { kind: "final", label: { outcome: "rejected", reason: "bad_request" }, call: null };
    case "api_error":
      return { kind: "api_error" };
  }
}

export async function labelFilings(
  db: Database,
  options: LabelFilingsOptions,
): Promise<LabelFilingsOutcome> {
  const { client } = options;
  if (client === null) {
    return emptyOutcome("off");
  }
  const outcome = emptyOutcome("ran");
  const filings = await filingsOfCompaniesSince(db, options.cnpjs, labelWindowStart(options.now));
  const states = await filingLabelStates(db, filings);
  const stateOf = new Map(
    states.map((state) => [`${state.protocol}:${String(state.version)}`, state]),
  );
  const watched = new Set(options.watchedCnpjs);
  const todo = filings
    .filter((filing) => {
      const state = stateOf.get(`${filing.protocol}:${String(filing.version)}`);
      if (state === undefined) {
        return true;
      }
      return (
        state.outcome === "pending" &&
        options.now.getTime() - state.updatedAt.getTime() >= RETRY_AFTER_MS
      );
    })
    .sort((a, b) => Number(watched.has(b.cnpj)) - Number(watched.has(a.cnpj)));

  for (const [index, filing] of todo.entries()) {
    if (index >= MAX_LABEL_CALLS_PER_RUN || Date.now() + ITEM_BUDGET_MS > options.deadlineAt) {
      outcome.deferred = todo.length - index;
      break;
    }
    if (index > 0) {
      await options.sleep(DOWNLOAD_SPACING_MS);
    }
    const step = await labelOne(db, client, filing, options.fetchImpl);
    if (step === "api_error") {
      // The API itself is down or the key is refused: every other filing
      // would fail the same way, so they wait for the next run untouched.
      outcome.retryLater += todo.length - index;
      break;
    }
    outcome[step] += 1;
  }
  return outcome;
}

async function labelOne(
  db: Database,
  client: FilingLabelClient,
  filing: CompanyFilingOfCompany,
  fetchImpl: typeof fetch,
): Promise<"labelled" | "rejected" | "unreadable" | "retryLater" | "api_error"> {
  const key = { protocol: filing.protocol, version: filing.version };
  const document = await fetchFilingDocument(filing.documentUrl, fetchImpl);
  switch (document.kind) {
    case "unavailable": {
      const attempts = await recordPendingAttempt(db, key);
      if (attempts < MAX_DOWNLOAD_ATTEMPTS) {
        return "retryLater";
      }
      await recordFinalFilingLabel(db, key, { outcome: "unreadable", reason: "unavailable" }, null);
      return "unreadable";
    }
    case "not_pdf":
    case "too_large":
      await recordFinalFilingLabel(db, key, { outcome: "unreadable", reason: document.kind }, null);
      return "unreadable";
    case "pdf":
      break;
  }
  const inputs = filingLabelInputsSchema.safeParse({
    companyName: filing.companyName,
    category: filing.category,
    kind: filing.kind,
    subject: filing.subject,
    deliveredOn: filing.deliveredOn,
  });
  if (!inputs.success) {
    await recordFinalFilingLabel(db, key, { outcome: "unreadable", reason: "bad_request" }, null);
    return "unreadable";
  }
  const result = resultOfReply(await client.label({ pdf: document.bytes, inputs: inputs.data }));
  if (result.kind === "api_error") {
    return "api_error";
  }
  await recordFinalFilingLabel(db, key, result.label, result.call);
  return result.label.outcome;
}
