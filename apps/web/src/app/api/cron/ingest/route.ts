import { timingSafeEqual } from "node:crypto";

import { sessionDateSchema } from "@fetha/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/db/client";
import { ingest, type IngestOutcome } from "@/modules/market-data";
import { evaluateSignalsForSession } from "@/modules/strategies";

export const maxDuration = 300;
// Ingestion and evaluation share this one `maxDuration` budget; the deadline
// below leaves this much headroom for the evaluation's in-flight user to
// finish and the response to serialize, rather than letting the platform
// hard-kill the function mid-write (#19).
const EVALUATION_SAFETY_MARGIN_MS = 15_000;

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

// `force` (#19 round 3 item 3): the owner's re-run after correcting a stale
// or wrong candle. Without it, a session already covered by every active
// strategy's own watermark short-circuits before the engine ever runs
// again, so the correction would never reach the inbox or the log.
const manualTriggerBodySchema = z
  .object({ session: sessionDateSchema.optional(), force: z.boolean().optional() })
  .strict();

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
async function runIngestion(
  session: string | undefined,
  force: boolean | undefined,
): Promise<NextResponse> {
  const db = getDb();
  const startedAt = Date.now();
  const result = await ingest(db, session ? { session } : {});
  const deadlineAt = startedAt + maxDuration * 1000 - EVALUATION_SAFETY_MARGIN_MS;
  const evaluation =
    cotahistSucceeded(result) && result.okSessions.length > 0
      ? await evaluateSignalsForSession(db, result.okSessions, { deadlineAt, force })
      : null;
  return NextResponse.json({ ...result, evaluation }, { status: result.ok ? 200 : 500 });
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return runIngestion(undefined, undefined);
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

  // `force`'s only stated purpose is re-running one corrected session
  // (#19 round 4 item 3): a bare `{"force": true}` during a multi-day
  // backlog would otherwise turn the whole drained range into overwrite
  // mode for every user, so it is rejected with its own message rather than
  // the generic "invalid session date" above.
  if (parsed.data.force === true && parsed.data.session === undefined) {
    return NextResponse.json(
      { ok: false, error: "force requires an explicit session" },
      { status: 400 },
    );
  }

  return runIngestion(parsed.data.session, parsed.data.force);
}
