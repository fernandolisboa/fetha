import { timingSafeEqual } from "node:crypto";

import { sessionDateSchema } from "@fetha/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb, type Database } from "@/db/client";
import { scoreDueDecisions } from "@/modules/decisions";
import { freshness, ingest, type IngestOutcome } from "@/modules/market-data";
import { evaluateSignalsForSession } from "@/modules/strategies";

export const maxDuration = 300;
// Ingestion, evaluation and scoring share this one `maxDuration` budget; the
// deadline below leaves this much headroom for whichever step is in flight
// to finish and the response to serialize, rather than letting the platform
// hard-kill the function mid-write (#19, #29).
const EVALUATION_SAFETY_MARGIN_MS = 15_000;
// Scoring runs after evaluation in the same budget (#29): a second, smaller
// margin so a scoring pass that is still running when the evaluation
// deadline was already close never itself gets hard-killed mid-write.
const SCORING_SAFETY_MARGIN_MS = 10_000;

function isAuthorized(authorizationHeader: string | null): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !authorizationHeader) {
    return false;
  }
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(authorizationHeader);
  // Constant-time compare: guards the cron endpoint against timing attacks on the secret.
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const manualTriggerBodySchema = z.object({ session: sessionDateSchema.optional() }).strict();

// Gated on the cotahist source's own outcome, not the whole run's `ok`
// (#19 round 2 item 1): cotahist is the only source candles come from, so a
// night Bacen SGS or the instruments registry fails must not suppress
// evaluation for every session cotahist actually drained cleanly — that
// suppression previously compounded silently because `since` was anchored
// on the ingestion calendar instead of each user's own watermark
// (evaluate-signals.ts), so the skipped sessions were never retried once a
// later run's drained range moved past them.
function cotahistSucceeded(result: IngestOutcome): boolean {
  const cotahist = result.sources.find((source) => source.source === "cotahist");
  return cotahist !== undefined && cotahist.error === undefined;
}

// Evaluation is chained after ingestion in the same run, same bearer (#19,
// CONTEXT.md "Nightly ingestion and daily evaluation"). The evaluation's own
// failures never turn an otherwise successful ingestion response into a
// 500 — they are reported alongside it so the owner can see them without
// the ingestion retry (docs/adr/0010-intraday-evaluation-while-in-use.md's
// addendum) firing for a session that already ingested cleanly.
// The newest session in the drained range, the same "asOf" the scoring job
// uses `evaluateSignalsForSession` already computes internally as `at`
// (evaluate-signals.ts) — recomputed here rather than threaded out of that
// function's return value, since `okSessions` is the same list both steps
// derive it from.
function newestSession(sessions: string[]): string | undefined {
  return [...sessions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).at(-1);
}

// A decision is due once its horizon reaches the latest session cotahist
// actually has data for (brief item 2), not only a session this particular
// run happened to drain: a re-run with nothing new to ingest (`okSessions`
// empty) must still score decisions whose horizon a *previous* night's
// ingestion already covers. `result.okSessions` is preferred when this run
// drained something, since it is already in hand with no extra read.
async function resolveScoringAsOfSession(
  db: Database,
  result: IngestOutcome,
): Promise<string | undefined> {
  if (cotahistSucceeded(result)) {
    const newest = newestSession(result.okSessions);
    if (newest) {
      return newest;
    }
  }
  const runs = await freshness(db);
  return runs.find((run) => run.source === "cotahist" && run.status === "succeeded")?.session;
}

async function runIngestion(session: string | undefined): Promise<NextResponse> {
  const db = getDb();
  const startedAt = Date.now();
  const result = await ingest(db, session ? { session } : {});
  const evaluationDeadlineAt = startedAt + maxDuration * 1000 - EVALUATION_SAFETY_MARGIN_MS;
  const evaluation =
    cotahistSucceeded(result) && result.okSessions.length > 0
      ? await evaluateSignalsForSession(db, result.okSessions, { deadlineAt: evaluationDeadlineAt })
      : null;

  // Scoring is chained after evaluation, same run, same bearer (#29): its
  // own failures never turn an otherwise successful ingestion response into
  // a 500, reported alongside it the same way evaluation's are (round 2
  // item 2 of #19 set that precedent for setup failures).
  const scoringDeadlineAt = startedAt + maxDuration * 1000 - SCORING_SAFETY_MARGIN_MS;
  const asOfSession = await resolveScoringAsOfSession(db, result);
  const scoring = asOfSession
    ? await scoreDueDecisions(db, asOfSession, { deadlineAt: scoringDeadlineAt })
    : null;

  return NextResponse.json({ ...result, evaluation, scoring }, { status: result.ok ? 200 : 500 });
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return runIngestion(undefined);
}

// The owner's manual trigger (#12): same bearer, optional `session` date for
// re-running a specific session (used by Playwright later). Rate limiting is
// the bearer being secret, the same shape the existing GET handler already
// relies on.
export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let rawBody: unknown = {};
  const text = await request.text();
  if (text.length > 0) {
    try {
      rawBody = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
    }
  }

  const parsed = manualTriggerBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid session date" }, { status: 400 });
  }

  return runIngestion(parsed.data.session);
}
