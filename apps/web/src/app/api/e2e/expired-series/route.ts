import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth";
import { latestExpiredTradedSeries } from "@/modules/market-data";

import { timingSafeEqualStrings } from "../verification-link/timing-safe-equal-strings";

const UNDERLYING = "PETR4";

// E2E-only, same guard as `/api/e2e/verification-link`: `portfolio.spec.ts`
// needs a real expired PETR4 series from the preview's ingested COTAHIST data
// to record a fill in and settle; it reads shared reference data only.
export async function GET(request: Request): Promise<Response> {
  const configuredSecret = readE2ESecret();
  if (isProductionDeployment() || !configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }

  const providedSecret = request.headers.get("x-e2e-secret") ?? "";
  if (!timingSafeEqualStrings(providedSecret, configuredSecret)) {
    return new NextResponse(null, { status: 404 });
  }

  const series = await latestExpiredTradedSeries(getDb(), UNDERLYING);
  if (!series) {
    return NextResponse.json({ error: "no expired PETR4 series is ingested" }, { status: 409 });
  }
  return NextResponse.json(series);
}
