import type { SessionOpen } from "./parser";
import { parseSgsResponse, splitIntoTenYearWindows } from "./parser";
import type { MacroPoint, MacroSeriesKind } from "./schema";
import { sgsNotFoundBodySchema, sgsSeriesCodes } from "./schema";

export class SgsFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly contentType?: string,
  ) {
    super(message);
    this.name = "SgsFetchError";
  }
}

// SGS answers a date range that holds no value yet with this 404 body
// (reproduced 2026-09-28, #216), e.g. the CDI of a session Bacen has not
// published by the time the nightly cron runs. The body is matched on a 2xx
// too: the nightly report recorded 200s carrying some JSON object around
// publication time, body not kept (#289). On any other status, or with any
// other body, it stays an error, so an outage is never read as "pending".
export class SgsNotPublishedError extends SgsFetchError {
  constructor(series: MacroSeriesKind, status: number) {
    super(`SGS has no value yet for series ${series} in the requested range`, status);
    this.name = "SgsNotPublishedError";
  }
}

const RETRY_DELAY_MS = 1_000;
// Well under the cron's maxDuration, so a stalled connection still leaves
// time for the retry and every source after this one.
const REQUEST_TIMEOUT_MS = 15_000;

interface SgsAnswer {
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
}

// The header is server-controlled text that ends up in the nightly report
// (ADR-0045), so only a well-formed media type is kept.
function mediaTypeOf(response: Response): string {
  const mediaType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  return mediaType !== undefined && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType)
    ? mediaType
    : "unknown";
}

// Node's fetch rejects with a TypeError ("fetch failed", "terminated") for
// DNS, connect, reset and mid-body failures, and the timeout signal with a
// TimeoutError; any other rejection is a bug, not a transient fault.
function isTransient(error: unknown): boolean {
  return (
    error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")
  );
}

async function requestOnce(url: string, fetchImpl: typeof fetch): Promise<SgsAnswer> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return {
    status: response.status,
    ok: response.ok,
    contentType: mediaTypeOf(response),
    text: await response.text(),
  };
}

async function fetchWithOneRetry(
  series: MacroSeriesKind,
  url: string,
  fetchImpl: typeof fetch,
  retryDelayMs: number,
): Promise<SgsAnswer> {
  try {
    const answer = await requestOnce(url, fetchImpl);
    if (answer.status < 500) {
      return answer;
    }
  } catch (error) {
    if (!isTransient(error)) {
      throw error;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  try {
    return await requestOnce(url, fetchImpl);
  } catch (error) {
    if (!isTransient(error)) {
      throw error;
    }
    throw new SgsFetchError(`SGS request failed for series ${series} (network error)`);
  }
}

function jsonBodyOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function readSgsBody(series: MacroSeriesKind, answer: SgsAnswer): unknown {
  const { status, contentType } = answer;
  const body = jsonBodyOf(answer.text);
  const mayBeNotPublished = answer.ok || status === 404;
  if (mayBeNotPublished && sgsNotFoundBodySchema.safeParse(body).success) {
    throw new SgsNotPublishedError(series, status);
  }
  const detail = `(HTTP ${String(status)}, ${contentType})`;
  if (!answer.ok) {
    throw new SgsFetchError(`SGS fetch failed for series ${series} ${detail}`, status, contentType);
  }
  if (!Array.isArray(body)) {
    throw new SgsFetchError(
      `SGS returned an unexpected response for series ${series} ${detail}`,
      status,
      contentType,
    );
  }
  return body;
}

function toBrDate(isoDate: string): string {
  const [year = "", month = "", day = ""] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// docs/research/2026-09-02-market-data-providers.md, section 5: the API
// enforces a 10-year window per request as of March 2025.
export function sgsUrl(series: MacroSeriesKind, from: string, to: string): string {
  const code = sgsSeriesCodes[series];
  const params = new URLSearchParams({
    formato: "json",
    dataInicial: toBrDate(from),
    dataFinal: toBrDate(to),
  });
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${String(code)}/dados?${params.toString()}`;
}

export async function fetchSgsSeries(
  series: MacroSeriesKind,
  from: string,
  to: string,
  sessions: SessionOpen[],
  fetchImpl: typeof fetch = fetch,
  retryDelayMs = RETRY_DELAY_MS,
): Promise<MacroPoint[]> {
  const windows = splitIntoTenYearWindows(from, to);
  const results: MacroPoint[] = [];
  for (const window of windows) {
    const url = sgsUrl(series, window.from, window.to);
    const answer = await fetchWithOneRetry(series, url, fetchImpl, retryDelayMs);
    const body = readSgsBody(series, answer);
    results.push(...parseSgsResponse(series, body, sessions));
  }
  return results;
}
