import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

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

export function GET(request: Request): NextResponse {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
