import { timingSafeEqual } from "node:crypto";

import { sessionDateSchema } from "@fetha/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/db/client";
import { ingest } from "@/modules/market-data";

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

const manualTriggerBodySchema = z.object({ session: sessionDateSchema.optional() }).strict();

async function runIngestion(session: string | undefined): Promise<NextResponse> {
  const result = await ingest(getDb(), session ? { session } : {});
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
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
