import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

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

const sessionDateRegex = /^\d{4}-\d{2}-\d{2}$/;

async function runIngestion(session: string | undefined): Promise<NextResponse> {
  const result = await ingest(getDb(), session ? { session } : {});
  return NextResponse.json({ ok: true, ...result });
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

  let session: string | undefined;
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "session" in body) {
      const value = (body as { session?: unknown }).session;
      if (typeof value === "string") {
        session = value;
      }
    }
  } catch {
    session = undefined;
  }

  if (session !== undefined && !sessionDateRegex.test(session)) {
    return NextResponse.json({ ok: false, error: "invalid session date" }, { status: 400 });
  }

  return runIngestion(session);
}
