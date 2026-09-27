import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { runNightlyJob } from "@/modules/nightly";

export const maxDuration = 300;

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

// Vercel Cron's own trigger only (#51): the owner's manual trigger moved to
// a session-authenticated Server Action (@/modules/nightly) restricted to
// the OWNER_EMAILS allowlist, so CRON_SECRET is never handled by a human
// anymore.
export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const outcome = await runNightlyJob(getDb());
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 });
}
