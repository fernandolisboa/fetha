import { cache } from "react";
import type { Instant, SessionDate, Ticker } from "@fetha/contracts";
import type { OperationLeg, OptionRight } from "@fetha/engine";

import { getDb, type Database } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { recordAccess } from "@/modules/audit";
import { requireUser } from "@/modules/auth";
import { corporateActionFactorsForUnderlying, tradingSessionForDate } from "@/modules/market-data";

import { holdingKey } from "./bookkeeping";
import {
  heldExpiry,
  planOperation,
  type OperationPlan,
  type SeriesByHolding,
} from "./operation-plan";
import { PortfolioRepository, type FillRecord } from "./portfolio-repository";
import { corporateActionsByUnderlying, hasExpired, seriesByHolding } from "./portfolio-service";
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

interface PlannedOperation {
  underlying: Ticker;
  fillIds: string[];
  plan: OperationPlan;
}

interface PlannedOperations {
  byId: Map<string, PlannedOperation>;
  series: SeriesByHolding;
}

// The plan of each of the user's open operations, from its fills: the live
// legs a held operation's expiry and default horizon come from, never the
// stored `operations.expiry` alone (#259). `ids`, when given, narrows the
// set planned; omitted, every open operation is planned (#382: the roll
// agenda and the operation page need this without the engine valuation
// `getMyPortfolio` carries). Returns the series map alongside the plans so a
// caller can read a leg's own strike and right without looking fills up a
// second time (#382).
async function planMyOpenOperations(
  db: Database,
  user: ScopedUser,
  ids?: readonly string[],
): Promise<PlannedOperations> {
  const repository = new PortfolioRepository(db, user);
  const wanted = ids ? new Set(ids) : null;
  const [operations, fills] = await Promise.all([
    repository.listOperations(),
    repository.listFills(),
  ]);
  const openOperations = operations.filter(
    (operation) => operation.status === "open" && (!wanted || wanted.has(operation.id)),
  );
  const underlyingById = new Map(
    openOperations.map((operation) => [operation.id, operation.underlying]),
  );
  const fillsById = new Map(openOperations.map((operation) => [operation.id, [] as FillRecord[]]));
  for (const fill of fills) {
    if (fill.operationId !== null) {
      fillsById.get(fill.operationId)?.push(fill);
    }
  }
  const [series, corporateActions] = await Promise.all([
    seriesByHolding(db, [...fillsById.values()].flat()),
    corporateActionsByUnderlying(db, underlyingById.values()),
  ]);
  const byId = new Map(
    openOperations.map((operation) => {
      const own = fillsById.get(operation.id) ?? [];
      return [
        operation.id,
        {
          underlying: operation.underlying,
          fillIds: own.map((fill) => fill.id),
          plan: planOperation(own, series, corporateActions),
        },
      ];
    }),
  );
  return { byId, series };
}

// ADR-0022 item 1: a decision is recorded only on an open operation whose
// expiry session has not closed; one pending settlement is settled, not held.
export const getMyHeldOperation = cache(async (id: string): Promise<HeldOperation> => {
  const user = await requireUser();
  await recordAccess("portfolio_read");
  const db = getDb();
  const planned = (await planMyOpenOperations(db, user, [id])).byId.get(id);
  if (!planned?.plan.ok || planned.plan.state.legs.length === 0) {
    throw new HeldOperationNotFoundError();
  }
  const { state } = planned.plan;
  const expiry = heldExpiry(state);
  if (expiry && (await hasExpired(db, expiry, nowInstant()))) {
    throw new HeldOperationNotFoundError();
  }
  return {
    id,
    underlying: state.underlying,
    expiry,
    openedAt: state.openedAt,
    legs: state.legs,
    fillIds: planned.fillIds,
  };
});

// The `heldExpiry` of each of the user's open operations among `ids`; an id
// that is not one of the user's open operations is absent.
export async function getMyOpenOperationExpiries(
  ids: readonly string[],
): Promise<Map<string, SessionDate | null>> {
  if (ids.length === 0) {
    return new Map();
  }
  const user = await requireUser();
  await recordAccess("portfolio_read");
  const { byId } = await planMyOpenOperations(getDb(), user, ids);
  return new Map([...byId].map(([id, { plan }]) => [id, plan.ok ? heldExpiry(plan.state) : null]));
}

export interface OpenOperationPlanLeg extends OperationLeg {
  // The leg's own strike and right, read once here from the series map `openOperationPlansFor`
  // already built, so a caller never calls `seriesByHolding` again per operation (#382). Null
  // for the stock leg, which carries no series.
  strike: string | null;
  right: OptionRight | null;
}

export interface OpenOperationPlanRow {
  operationId: string;
  underlying: Ticker;
  legs: OpenOperationPlanLeg[];
  heldExpiry: SessionDate | null;
  pendingSettlement: boolean;
}

// Every one of the user's open operations' own legs (each with its own strike and right) and
// held expiry, without the engine valuation `getMyPortfolio` carries (#382): the roll agenda and
// the operation page header only need an operation's legs, expiry and whether it is pending
// settlement, never a mark-to-market. "Pending settlement" here means the same thing
// `loadPortfolio` means by it: an open option leg whose expiry session has already closed.
// Parameterized by `db`/`user` (rather than reading the session itself) so an integration test
// can exercise it for two different users without a request context, the same split
// `loadPortfolio`/`getMyPortfolio` already makes.
export async function openOperationPlansFor(
  db: Database,
  user: ScopedUser,
): Promise<OpenOperationPlanRow[]> {
  const { byId, series } = await planMyOpenOperations(db, user);
  const rows: OpenOperationPlanRow[] = [];
  for (const [operationId, { underlying, plan }] of byId) {
    if (!plan.ok) continue;
    const expiry = heldExpiry(plan.state);
    const legs: OpenOperationPlanLeg[] = plan.state.legs.map((leg) => {
      const facts = expiry ? series.get(holdingKey(leg.ticker, expiry)) : undefined;
      return { ...leg, strike: facts?.strike ?? null, right: facts?.right ?? null };
    });
    const openOption = legs.some((leg) => leg.role !== "stock");
    const pendingSettlement =
      openOption && expiry !== null && (await hasExpired(db, expiry, nowInstant()));
    rows.push({
      operationId,
      underlying,
      legs,
      heldExpiry: expiry,
      pendingSettlement,
    });
  }
  return rows;
}

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
  // Not only `fill.operationId === operation.id` (#382): a covered call's stock leg carries
  // forward onto a new operation's own id when the position is rolled, so a decision recorded
  // before the roll would otherwise score it as a naked short call, missing the stock leg
  // entirely. The decision's own `heldFillIds`, recorded at decision time, names the fills that
  // actually backed it regardless of which operation currently owns them.
  const heldFillIdSet = new Set(request.heldFillIds);
  const operationFills = fills.filter(
    (fill) => fill.operationId === operation.id || heldFillIdSet.has(fill.id),
  );
  const [series, corporateActions] = await Promise.all([
    seriesByHolding(db, operationFills),
    corporateActionFactorsForUnderlying(db, operation.underlying),
  ]);
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
    horizonDate: todaySaoPauloDate(new Date(request.horizonClose)),
    closeOf: (session) => closes.get(session) ?? null,
    rightOf: (ticker, expiry) =>
      expiry ? (series.get(holdingKey(ticker, expiry))?.right ?? null) : null,
    corporateActions,
  });
}
