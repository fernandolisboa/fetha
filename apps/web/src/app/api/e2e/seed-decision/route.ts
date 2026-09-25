import { NextResponse } from "next/server";
import { centavosSchema, decimalStringSchema, quantitySchema, tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { isProductionDeployment, readE2ESecret, requireUser, UnauthenticatedError } from "@/modules/auth";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { decisions } from "@/modules/decisions/schema";
import type { DecisionInputs } from "@/modules/decisions";
import { OperationsRepository } from "@/modules/portfolio";
import { structures } from "@/modules/strategies/schema";

import { timingSafeEqualStrings } from "../verification-link/timing-safe-equal-strings";

// The ingested session `decisions.spec.ts` and `signals.spec.ts` already
// use for the manual cron trigger: real cotahist data for it exists on
// every environment this route is reachable on (never production, guarded
// below), so a claim scored against it is scored against real market data,
// not a fixture.
const INGESTED_SESSION = "2026-09-09";
const UNDERLYING = tickerSchema.parse("PETR4");
const STOCK_STRUCTURE_ID = "stock";

async function ensureStockStructure(): Promise<void> {
  await getDb()
    .insert(structures)
    .values({
      id: STOCK_STRUCTURE_ID,
      name: "Compra de ação",
      legs: [{ role: "stock", side: "buy", ratio: 1 }],
    })
    .onConflictDoNothing();
}

function operationInputs(): DecisionInputs {
  return {
    originKind: "contemplated_operation",
    underlying: UNDERLYING,
    structureId: STOCK_STRUCTURE_ID,
    structureName: "Compra de ação",
    legs: [
      { role: "stock", side: "buy", ticker: UNDERLYING, quantity: quantitySchema.parse(100) },
    ],
    session: INGESTED_SESSION,
    netPremiumCentavos: centavosSchema.parse(300000),
    maxLossCentavos: centavosSchema.parse(300000),
    maxGainCentavos: null,
    breachedLimits: [],
  };
}

// E2E-only, mirroring `/api/e2e/verification-link` exactly (404 in
// production or with no `E2E_SECRET` configured, constant-time header
// compare): seeds a decision the nightly scoring job (#29) can pick up on
// its very next run, without going through the UI form `decisions.spec.ts`
// already covers. A single `INSERT`, never an `UPDATE` — the same
// append-only shape every other write to `decisions` has (schema.ts,
// `decisions_no_update`).
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

  const db = getDb();
  await ensureStockStructure();

  const operationsRepository = new OperationsRepository(db, user);
  const operation = await operationsRepository.save({
    structureId: STOCK_STRUCTURE_ID,
    underlying: UNDERLYING,
    legs: [
      { role: "stock", side: "buy", ticker: UNDERLYING, quantity: quantitySchema.parse(100) },
    ],
    session: INGESTED_SESSION,
    netPremiumCentavos: centavosSchema.parse(300000),
    maxLossCentavos: centavosSchema.parse(300000),
    maxGainCentavos: null,
    breachedLimits: [],
  });

  const [row] = await db
    .insert(decisions)
    .values({
      userId: user.id,
      kind: "do_not_enter",
      originKind: "contemplated_operation",
      signalId: null,
      contemplatedOperationId: operation.id,
      strategyVersionId: null,
      inputs: operationInputs(),
      rationale: "Seeded by the E2E scoring flow (seed-decision route).",
      // Virtually certain to hold against real B3 data: PETR4 has not
      // closed at or below R$ 1 in the ingested session range this route
      // is ever exercised against.
      claim: { kind: "close_above", instrument: UNDERLYING, level: decimalStringSchema.parse("1") },
      confidence: "0.7",
      horizon: INGESTED_SESSION,
      costModel: DEFAULT_COST_MODEL,
      decidedAt: new Date(`${INGESTED_SESSION}T21:05:00.000Z`),
    })
    .returning({ id: decisions.id });

  if (!row) {
    return NextResponse.json({ error: "failed to insert decision" }, { status: 500 });
  }

  return NextResponse.json({ id: row.id }, { status: 201 });
}
