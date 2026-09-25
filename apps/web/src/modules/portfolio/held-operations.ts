import { cache } from "react";
import type { Instant, SessionDate, Ticker } from "@fetha/contracts";
import type { OperationLeg } from "@fetha/engine";

import { getDb, type Database } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { requireUser } from "@/modules/auth";
import { tradingSessionForDate } from "@/modules/market-data";

import { holdingKey } from "./bookkeeping";
import { planOperation } from "./operation-plan";
import { PortfolioRepository } from "./portfolio-repository";
import { hasExpired, seriesByHolding } from "./portfolio-service";
import { realizedOperation, type RealizedOperationResult } from "./realized-operation";

export interface HeldOperation {
  id: string;
  underlying: Ticker;
  expiry: SessionDate | null;
  openedAt: SessionDate;
  legs: OperationLeg[];
  fillIds: string[];
}

export class HeldOperationNotFoundError extends Error {
  constructor() {
    super("No open operation with this id");
    this.name = "HeldOperationNotFoundError";
  }
}

// ADR-0022 item 1: a decision is recorded only on an open operation whose
// expiry session has not closed; one pending settlement is settled, not held.
export const getMyHeldOperation = cache(async (id: string): Promise<HeldOperation> => {
  const user = await requireUser();
  const db = getDb();
  const repository = new PortfolioRepository(db, user);
  const [operations, fills] = await Promise.all([
    repository.listOperations(),
    repository.listFills(),
  ]);
  const operation = operations.find(
    (candidate) => candidate.id === id && candidate.status === "open",
  );
  if (!operation) {
    throw new HeldOperationNotFoundError();
  }
  const operationFills = fills.filter((fill) => fill.operationId === operation.id);
  const plan = planOperation(operationFills, await seriesByHolding(db, operationFills));
  if (!plan.ok || plan.state.legs.length === 0) {
    throw new HeldOperationNotFoundError();
  }
  const expiry = plan.state.expiry;
  if (expiry && (await hasExpired(db, expiry, nowInstant()))) {
    throw new HeldOperationNotFoundError();
  }
  return {
    id: operation.id,
    underlying: plan.state.underlying,
    expiry,
    openedAt: plan.state.openedAt,
    legs: plan.state.legs,
    fillIds: operationFills.map((fill) => fill.id),
  };
});

export interface HeldOperationScoringRequest {
  operationId: string;
  heldFillIds: readonly string[];
  decidedAt: Instant;
  horizonClose: Instant;
}

// The engine's `Operation` and `realizedFills` for a decision on a held
// operation (ADR-0022 item 4), read for the decision's own user by the
// nightly scoring job, which has no session.
export async function heldOperationForScoring(
  db: Database,
  user: ScopedUser,
  request: HeldOperationScoringRequest,
): Promise<RealizedOperationResult | { ok: false; reason: "operation_not_found" }> {
  const repository = new PortfolioRepository(db, user);
  const [operations, fills] = await Promise.all([
    repository.listOperations(),
    repository.listFills(),
  ]);
  const operation = operations.find((candidate) => candidate.id === request.operationId);
  if (!operation) {
    return { ok: false, reason: "operation_not_found" };
  }
  const operationFills = fills.filter((fill) => fill.operationId === operation.id);
  const series = await seriesByHolding(db, operationFills);
  const decisionDate = todaySaoPauloDate(new Date(request.decidedAt));
  const closes = new Map<SessionDate, Instant>();
  await Promise.all(
    [...new Set(operationFills.map((fill) => fill.session))]
      .filter((session) => session >= decisionDate)
      .map(async (session) => {
        const tradingSession = await tradingSessionForDate(db, session);
        if (tradingSession) {
          closes.set(session, tradingSession.close);
        }
      }),
  );
  return realizedOperation({
    id: operation.id,
    underlying: operation.underlying,
    expiry: operation.expiry,
    openedAt: operation.openedAt,
    fills: operationFills,
    heldFillIds: new Set(request.heldFillIds),
    decidedAt: request.decidedAt,
    decisionDate,
    horizonClose: request.horizonClose,
    closeOf: (session) => closes.get(session) ?? null,
    rightOf: (ticker, expiry) =>
      expiry ? (series.get(holdingKey(ticker, expiry))?.right ?? null) : null,
  });
}
