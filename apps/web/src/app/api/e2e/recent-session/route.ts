import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth";
import { calendarUpTo } from "@/modules/market-data";

import { timingSafeEqualStrings } from "../verification-link/timing-safe-equal-strings";

// E2E-only, same guard as `/api/e2e/verification-link`. The signal inbox only
// takes entries from its newest few closed sessions (docs/adr/0044), so
// signals.spec.ts and decisions.spec.ts need a recent session, not a fixed
// date. The second newest closed one stays inside that horizon and its
// COTAHIST file is always published, even right after today's close. Reads
// the calendar ingestion stores, so it answers once any session is ingested.
export async function GET(request: Request): Promise<Response> {
  const configuredSecret = readE2ESecret();
  if (isProductionDeployment() || !configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }

  const providedSecret = request.headers.get("x-e2e-secret") ?? "";
  if (!timingSafeEqualStrings(providedSecret, configuredSecret)) {
    return new NextResponse(null, { status: 404 });
  }

  const closed = await calendarUpTo(getDb(), new Date());
  const session = closed.at(-2);
  if (!session) {
    return NextResponse.json({ error: "the trading calendar is not ingested" }, { status: 409 });
  }
  return NextResponse.json({ session: session.date });
}
