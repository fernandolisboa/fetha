import { NextResponse } from "next/server";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth";
import { seedE2ERadar } from "@/modules/radar";

import { timingSafeEqualStrings } from "../verification-link/timing-safe-equal-strings";

// PETR4 trades in every session the suite ingests (owner.setup.ts).
const UNDERLYING = tickerSchema.parse("PETR4");

// E2E-only, same guard as `/api/e2e/verification-link`: the preview holds too little history
// for a recipe to find an entry, so radar.spec.ts seeds one radar row through the module's own
// `seedE2ERadar` (docs/adr/0066).
export async function POST(request: Request): Promise<Response> {
  const configuredSecret = readE2ESecret();
  if (isProductionDeployment() || !configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }

  const providedSecret = request.headers.get("x-e2e-secret") ?? "";
  if (!timingSafeEqualStrings(providedSecret, configuredSecret)) {
    return new NextResponse(null, { status: 404 });
  }

  const result = await seedE2ERadar(getDb(), UNDERLYING);
  if (!result.ok) {
    if (result.reason === "e2e_not_available") {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.json({ error: "no ingested close for PETR4" }, { status: 409 });
  }
  return NextResponse.json({ session: result.session }, { status: 201 });
}
