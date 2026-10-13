import { Decimal } from "decimal.js";
import type { DecimalString } from "@fetha/contracts";

import { gdeltTimelineSchema, type GdeltMode, type GdeltTimeline } from "./schema";

const ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 1_000_000;
const RATE_LIMIT_TEXT = "limit requests";
// GDELT's tone runs from extremely negative to extremely positive; real
// values stay within a few units, so anything past this is a broken reply.
const MAX_ABS_TONE = 100;

export type GdeltResult<T> =
  { kind: "ok"; value: T } | { kind: "rate_limited" } | { kind: "failed"; reason: string };

export function gdeltUrl(query: string, mode: GdeltMode): string {
  const params = new URLSearchParams({ query, mode, timespan: "3months", format: "json" });
  return `${ENDPOINT}?${params.toString()}`;
}

export function parseGdeltBody(status: number, body: string): GdeltResult<GdeltTimeline> {
  if (status === 429 || body.includes(RATE_LIMIT_TEXT)) {
    return { kind: "rate_limited" };
  }
  if (status !== 200) {
    return { kind: "failed", reason: `HTTP ${String(status)}` };
  }
  const trimmed = body.trim();
  // A query with no match comes back as an empty object.
  if (trimmed === "{}" || trimmed === "") {
    return { kind: "ok", value: { timeline: [] } };
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    // An invalid query is answered with a plain-text explanation.
    return { kind: "failed", reason: "not JSON" };
  }
  const parsed = gdeltTimelineSchema.safeParse(json);
  return parsed.success
    ? { kind: "ok", value: parsed.data }
    : { kind: "failed", reason: "unexpected shape" };
}

export async function fetchGdeltTimeline(
  query: string,
  mode: GdeltMode,
  fetchImpl: typeof fetch,
): Promise<GdeltResult<GdeltTimeline>> {
  let response: Response;
  try {
    response = await fetchImpl(gdeltUrl(query, mode), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { kind: "failed", reason: "no response" };
  }
  let body: string;
  try {
    body = await response.text();
  } catch {
    return { kind: "failed", reason: "no response" };
  }
  if (body.length > MAX_BODY_CHARS) {
    return { kind: "failed", reason: "too large" };
  }
  return parseGdeltBody(response.status, body);
}

export interface GdeltDay {
  day: string;
  tone: DecimalString;
  articles: number;
}

function dayOf(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

// Joins the two timelines by day: the article count decides which days
// exist, and a day with articles but no tone point is left out rather than
// read as neutral.
export function mergeGdeltTimelines(
  tone: GdeltTimeline,
  volume: GdeltTimeline,
): GdeltResult<GdeltDay[]> {
  const toneByDay = new Map(
    (tone.timeline[0]?.data ?? []).map((point) => [dayOf(point.date), point.value]),
  );
  const days = new Map<string, GdeltDay>();
  for (const point of volume.timeline[0]?.data ?? []) {
    const articles = point.value;
    if (!Number.isInteger(articles) || articles < 0) {
      return { kind: "failed", reason: "bad article count" };
    }
    const day = dayOf(point.date);
    const value = toneByDay.get(day);
    if (articles === 0) {
      days.set(day, { day, tone: "0.0000" as DecimalString, articles });
      continue;
    }
    if (value === undefined) {
      days.delete(day);
      continue;
    }
    if (Math.abs(value) > MAX_ABS_TONE) {
      return { kind: "failed", reason: "tone out of range" };
    }
    days.set(day, { day, tone: new Decimal(value).toFixed(4) as DecimalString, articles });
  }
  // One row per day: a repeated day would fail the whole upsert.
  return { kind: "ok", value: [...days.values()] };
}
