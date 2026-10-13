import { ibovespa } from "../../market-index";
import { parseIndexYear } from "./parser";
import type { IndexClosePoint } from "./schema";

export class IndexFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly contentType?: string,
  ) {
    super(message);
    this.name = "IndexFetchError";
  }
}

const RETRY_DELAY_MS = 1_000;
// Mirrors bacen-sgs/fetch.ts's own budget (ADR-0062): well under the cron's
// maxDuration, so a stalled connection still leaves time for the retry and every source after
// this one.
const REQUEST_TIMEOUT_MS = 15_000;

function mediaTypeOf(response: Response): string {
  const mediaType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  return mediaType !== undefined && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType)
    ? mediaType
    : "unknown";
}

function isTransient(error: unknown): boolean {
  return (
    error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")
  );
}

interface IndexAnswer {
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
}

async function requestOnce(url: string, fetchImpl: typeof fetch): Promise<IndexAnswer> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return {
    status: response.status,
    ok: response.ok,
    contentType: mediaTypeOf(response),
    text: await response.text(),
  };
}

async function fetchWithOneRetry(
  year: number,
  url: string,
  fetchImpl: typeof fetch,
  retryDelayMs: number,
): Promise<IndexAnswer> {
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
    throw new IndexFetchError(
      `B3 index statistics request failed for IBOV ${String(year)} (network error)`,
    );
  }
}

function jsonBodyOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// `GetPortfolioDay/<base64 of {"index":"IBOV","language":"pt-br","year":"YYYY"}>`
// (ADR-0062): the service's own request code `IBOV` is never the registry's
// join key `IBOV11`, which is only assigned once a row is written to `candles`.
export function indexStatisticsUrl(year: number): string {
  const payload = JSON.stringify({ index: ibovespa.b3Code, language: "pt-br", year: String(year) });
  const encoded = Buffer.from(payload, "utf8").toString("base64");
  return `https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay/${encoded}`;
}

export async function fetchIndexYear(
  year: number,
  fetchImpl: typeof fetch = fetch,
  retryDelayMs = RETRY_DELAY_MS,
): Promise<IndexClosePoint[]> {
  const url = indexStatisticsUrl(year);
  const answer = await fetchWithOneRetry(year, url, fetchImpl, retryDelayMs);
  const detail = `(HTTP ${String(answer.status)}, ${answer.contentType})`;
  if (!answer.ok) {
    throw new IndexFetchError(
      `B3 index statistics fetch failed for IBOV ${String(year)} ${detail}`,
      answer.status,
      answer.contentType,
    );
  }
  const body = jsonBodyOf(answer.text);
  if (body === undefined) {
    throw new IndexFetchError(
      `B3 index statistics returned a non-JSON response for IBOV ${String(year)} ${detail}`,
      answer.status,
      answer.contentType,
    );
  }
  return parseIndexYear(year, body);
}
