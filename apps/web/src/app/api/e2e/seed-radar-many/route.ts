import { NextResponse } from "next/server";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth";
import { seedE2ERadarMany } from "@/modules/radar";

import { timingSafeEqualStrings } from "../verification-link/timing-safe-equal-strings";

// A handful of B3's most liquid optionable names (owner.setup.ts ingests the real COTAHIST
// universe, so each one either has a chain deep enough for a bull call spread or it does not;
// `seedE2ERadarMany` skips the ones that don't).
const CANDIDATES = ["PETR4", "VALE3", "BBAS3", "ITUB4", "BBDC4"].map((ticker) =>
  tickerSchema.parse(ticker),
);

// E2E-only, same guard as `/api/e2e/seed-radar`: files as many of `CANDIDATES` as the real
// chain resolves under the bull call spread recipe, at the same newest ingested close, so a
// spec can exercise a screen that needs several suggestions of one structure (the suggestions
// panel's per-structure cap, #378).
export async function POST(request: Request): Promise<Response> {
  const configuredSecret = readE2ESecret();
  if (isProductionDeployment() || !configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }

  const providedSecret = request.headers.get("x-e2e-secret") ?? "";
  if (!timingSafeEqualStrings(providedSecret, configuredSecret)) {
    return new NextResponse(null, { status: 404 });
  }

  const result = await seedE2ERadarMany(getDb(), CANDIDATES);
  return NextResponse.json(
    { session: result.session, suggestionIds: result.suggestionIds },
    { status: 201 },
  );
}
