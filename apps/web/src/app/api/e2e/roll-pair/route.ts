import { NextResponse } from "next/server";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth";
import { seedE2ERollPair } from "@/modules/portfolio";

import { timingSafeEqualStrings } from "../verification-link/timing-safe-equal-strings";

const UNDERLYING = tickerSchema.parse("PETR4");

// E2E-only, same guard as `/api/e2e/verification-link`: `roll.spec.ts` needs a PETR4 monthly
// expiry whose next monthly expiry also carries a traded series, read off the preview's own
// ingested chain rather than a hardcoded series so the suite survives the chain rolling off
// near-month expiries (apps/web/e2e/README.md).
export async function GET(request: Request): Promise<Response> {
  const configuredSecret = readE2ESecret();
  if (isProductionDeployment() || !configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }

  const providedSecret = request.headers.get("x-e2e-secret") ?? "";
  if (!timingSafeEqualStrings(providedSecret, configuredSecret)) {
    return new NextResponse(null, { status: 404 });
  }

  const result = await seedE2ERollPair(getDb(), UNDERLYING);
  if (!result.ok) {
    if (result.reason === "e2e_not_available") {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.json(
      { error: "no PETR4 roll pair ingested across two monthly expiries" },
      { status: 409 },
    );
  }
  return NextResponse.json(result.pair);
}
