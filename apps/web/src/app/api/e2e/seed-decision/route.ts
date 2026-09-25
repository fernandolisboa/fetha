import { NextResponse } from "next/server";
import {
  centavosSchema,
  confidenceSchema,
  decimalStringSchema,
  quantitySchema,
  tickerSchema,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import {
  isProductionDeployment,
  readE2ESecret,
  requireUser,
  UnauthenticatedError,
} from "@/modules/auth";
import { seedE2EDecision } from "@/modules/decisions";

import { timingSafeEqualStrings } from "../verification-link/timing-safe-equal-strings";

// The two sessions `decisions.spec.ts` and `signals.spec.ts` already use for
// the manual cron trigger: real cotahist data for both exists on every
// environment this route is reachable on (never production, guarded
// below), so a claim scored against them is scored against real market
// data, not a fixture. `DECIDED_SESSION` is strictly before `HORIZON`
// (quant: no look-ahead, #29 fix-web item 3) — the decision is recorded as
// if taken during `DECIDED_SESSION`'s own close, and its horizon only
// arrives on the *next* ingested session.
const DECIDED_SESSION = "2026-09-08";
const HORIZON = "2026-09-09";
const UNDERLYING = tickerSchema.parse("PETR4");

// E2E-only, mirroring `/api/e2e/verification-link` exactly (404 in
// production or with no `E2E_SECRET` configured, constant-time header
// compare): seeds a decision the nightly scoring job (#29) can pick up on
// its very next run, without going through the UI form `decisions.spec.ts`
// already covers. Every write goes through `seedE2EDecision`
// (`@/modules/decisions`) — no `@/modules/*/schema` import and no direct
// table write here (#29 fix-web item 3): this route only assembles the
// fixture's own values and reports the module's own typed outcome.
export async function POST(request: Request): Promise<Response> {
  const configuredSecret = readE2ESecret();
  if (isProductionDeployment() || !configuredSecret) {
    return new NextResponse(null, { status: 404 });
  }

  const providedSecret = request.headers.get("x-e2e-secret") ?? "";
  if (!timingSafeEqualStrings(providedSecret, configuredSecret)) {
    return new NextResponse(null, { status: 404 });
  }

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  const result = await seedE2EDecision(getDb(), user, {
    underlying: UNDERLYING,
    session: DECIDED_SESSION,
    decidedAt: new Date(`${DECIDED_SESSION}T21:05:00.000Z`),
    horizon: HORIZON,
    legs: [{ role: "stock", side: "buy", ticker: UNDERLYING, quantity: quantitySchema.parse(100) }],
    netPremiumCentavos: centavosSchema.parse(300000),
    maxLossCentavos: centavosSchema.parse(300000),
    maxGainCentavos: null,
    // Virtually certain to hold against real B3 data: PETR4 has not closed
    // at or below R$ 1 in the ingested session range this route is ever
    // exercised against.
    claim: { kind: "close_above", instrument: UNDERLYING, level: decimalStringSchema.parse("1") },
    confidence: confidenceSchema.parse("0.7"),
    rationale: "Seeded by the E2E scoring flow (seed-decision route).",
  });

  if (!result.ok) {
    if (result.reason === "e2e_not_available") {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.json(
      {
        error:
          "the shared structure catalog has no 'stock' structure seeded (run db:seed-structures)",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: result.id }, { status: 201 });
}
